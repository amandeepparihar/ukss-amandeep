import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { NotFoundError, ConflictError, BadRequestError } from '../../lib/errors';

const teamSelect = {
  teamsId: true,
  teamName: true,
  sort: true,
  created: true,
} as const;

const teamSortFields: Record<string, string> = {
  teams_id: 'teamsId',
  team_name: 'teamName',
  sort: 'sort',
  created: 'created',
};

// Max rows one export may return, shared across modules. Exports over this are rejected,
// not truncated, so raise EXPORT_ROW_LIMIT in .env if a genuinely larger export is needed.
const EXPORT_ROW_LIMIT = Number(process.env.EXPORT_ROW_LIMIT) || 50000;

// shared where/orderBy construction for the list and export queries
function buildTeamsFilter(params: { search?: string; sortBy: string }) {
  const { search, sortBy } = params;

  return {
    where: search ? { teamName: { contains: search } } : {},
    sortField: teamSortFields[sortBy] || 'sort',
  };
}

// Purpose: fetches all teams from the teams table with pagination, search and sorting
export async function getTeams(params: {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const { page, pageSize, search, sortBy = 'sort', sortOrder = 'asc' } = params;

  getLogger('teams-service').info({ page, pageSize, search, sortBy, sortOrder }, 'fetching teams');

  const { where, sortField } = buildTeamsFilter({ search, sortBy });

  try {
    const [total, teams] = await Promise.all([
      prisma.team.count({ where }),
      prisma.team.findMany({
        where,
        select: teamSelect,
        orderBy: [{ [sortField]: sortOrder }, { teamsId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    getLogger('teams-service').info({ total, count: teams.length }, 'teams fetched');

    return {
      data: teams,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    getLogger('teams-service').error(
      { err: error, page, pageSize, search, sortBy, sortOrder },
      'failed to fetch teams'
    );
    throw new Error('Internal Server Error');
  }
}

// Purpose: fetches the full filtered set of teams for export, without pagination
export async function getTeamsForExport(params: {
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const { search, sortBy = 'sort', sortOrder = 'asc' } = params;

  getLogger('teams-service').info({ search, sortBy, sortOrder }, 'fetching teams for export');

  const { where, sortField } = buildTeamsFilter({ search, sortBy });

  try {
    const total = await prisma.team.count({ where });

    if (total > EXPORT_ROW_LIMIT) {
      getLogger('teams-service').warn(
        { total, limit: EXPORT_ROW_LIMIT, search },
        'export blocked, row count over limit'
      );
      throw new BadRequestError(
        `This export matches ${total} teams, which is over the ${EXPORT_ROW_LIMIT} row limit. ` +
          'Narrow your search or filters and try again.'
      );
    }

    const teams = await prisma.team.findMany({
      where,
      select: teamSelect,
      orderBy: [{ [sortField]: sortOrder }, { teamsId: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    });

    getLogger('teams-service').info({ count: teams.length }, 'teams for export fetched');

    return teams;
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }
    getLogger('teams-service').error(
      { err: error, search, sortBy, sortOrder },
      'failed to fetch teams for export'
    );
    throw new Error('Internal Server Error');
  }
}

// Purpose: fetches a single team's details by id, used to load data into the edit form
export async function getTeamById(id: number) {
  getLogger('teams-service').info({ id }, 'fetching team');

  try {
    const team = await prisma.team.findUnique({
      where: { teamsId: id },
      select: teamSelect,
    });

    if (!team) {
      throw new NotFoundError('Team');
    }

    getLogger('teams-service').info({ id }, 'team fetched');

    return team;
  } catch (error) {
    if (error instanceof NotFoundError) {
      getLogger('teams-service').warn({ id }, 'team not found');
      throw error;
    }
    getLogger('teams-service').error({ err: error, id }, 'failed to fetch team');
    throw new Error('Internal Server Error');
  }
}

// Purpose: fetches the next available sort number to prefill the create form
export async function getNextSort() {
  getLogger('teams-service').info({}, 'fetching next sort value');

  try {
    // _max.sort is null on an empty table, so ?? 0 stands in for COALESCE
    const result = await prisma.team.aggregate({ _max: { sort: true } });
    const nextSort = (result._max.sort ?? 0) + 1;

    getLogger('teams-service').info({ nextSort }, 'next sort value fetched');

    return { nextSort };
  } catch (error) {
    getLogger('teams-service').error({ err: error }, 'failed to fetch next sort value');
    throw new Error('Internal Server Error');
  }
}

// helper used by checkNameAvailable, create and update
async function findDuplicateTeam(teamName: string, excludeId?: number) {
  return prisma.team.findFirst({
    where: {
      teamName,
      ...(excludeId ? { teamsId: { not: excludeId } } : {}),
    },
    select: { teamsId: true },
  });
}

// Purpose: checks if a given team name already exists, used for inline feedback while typing
export async function checkNameAvailable(name: string, excludeId?: number) {
  getLogger('teams-service').info({ name, excludeId }, 'checking name availability');

  const trimmedName = name.trim();

  try {
    const existing = await findDuplicateTeam(trimmedName, excludeId);
    const available = existing === null;

    getLogger('teams-service').info({ name, excludeId, available }, 'name availability checked');

    return { available };
  } catch (error) {
    getLogger('teams-service').error(
      { err: error, name, excludeId },
      'failed to check name availability'
    );
    throw new Error('Internal Server Error');
  }
}

// Purpose: inserts a new team row into the teams table
export async function createTeam(data: { teamName: string; sort: number }) {
  const trimmedName = data.teamName.trim();

  getLogger('teams-service').info({ teamName: trimmedName, sort: data.sort }, 'creating team');

  try {
    const duplicate = await findDuplicateTeam(trimmedName);

    if (duplicate) {
      getLogger('teams-service').warn({ teamName: trimmedName }, 'duplicate team name blocked');
      throw new ConflictError('A team with this name already exists');
    }

    const newTeam = await prisma.team.create({
      data: {
        teamName: trimmedName,
        sort: data.sort,
      },
      select: { teamsId: true },
    });

    getLogger('teams-service').info(
      { teamsId: newTeam.teamsId, teamName: trimmedName },
      'team created'
    );

    return await getTeamById(newTeam.teamsId);
  } catch (error) {
    if (error instanceof ConflictError) {
      throw error;
    }
    getLogger('teams-service').error(
      { err: error, teamName: trimmedName },
      'failed to create team'
    );
    throw new Error('Internal Server Error');
  }
}

// Purpose: updates an existing team's name and sort value in the teams table
export async function updateTeam(id: number, data: { teamName: string; sort: number }) {
  const trimmedName = data.teamName.trim();

  getLogger('teams-service').info({ id, teamName: trimmedName, sort: data.sort }, 'updating team');

  try {
    // check team exists
    const existing = await getTeamById(id);
    if (!existing) {
      throw new NotFoundError('Team');
    }

    const duplicate = await findDuplicateTeam(trimmedName, id);

    if (duplicate) {
      getLogger('teams-service').warn({ id, teamName: trimmedName }, 'duplicate team name blocked');
      throw new ConflictError('A team with this name already exists');
    }

    await prisma.team.update({
      where: { teamsId: id },
      data: { teamName: trimmedName, sort: data.sort },
      select: { teamsId: true },
    });

    getLogger('teams-service').info({ id, teamName: trimmedName }, 'team updated');

    return await getTeamById(id);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }
    getLogger('teams-service').error(
      { err: error, id, teamName: trimmedName },
      'failed to update team'
    );
    throw new Error('Internal Server Error');
  }
}

// Purpose: deletes a team row from the teams table, blocked if it is still referenced elsewhere
export async function deleteTeam(id: number) {
  getLogger('teams-service').info({ id }, 'deleting team');

  try {
    // check team exists
    const existing = await getTeamById(id);

    await prisma.$transaction(async (tx) => {
      const [productCount, logCount] = await Promise.all([
        tx.productList.count({ where: { teamsId: id } }),
        tx.smsProductsLog.count({ where: { teamsId: id } }),
      ]);

      if (productCount > 0 || logCount > 0) {
        getLogger('teams-service').warn(
          { id, productCount, logCount },
          'delete blocked, team in use'
        );

        const parts: string[] = [];
        if (productCount > 0) {
          parts.push(`${productCount} products`);
        }
        if (logCount > 0) {
          parts.push(`${logCount} product log entries`);
        }

        throw new ConflictError(
          `Cannot delete '${existing.teamName}': it is used by ${parts.join(' and ')}.`
        );
      }

      // delete. select teams_id only: the returned row would decode the zero-date rows and throw
      await tx.team.delete({ where: { teamsId: id }, select: { teamsId: true } });
    });

    getLogger('teams-service').info({ id }, 'team deleted');

    return { status: 'Deleted' };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }
    getLogger('teams-service').error({ err: error, id }, 'failed to delete team');
    throw new Error('Internal Server Error');
  }
}
