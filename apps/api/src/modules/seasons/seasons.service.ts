import { prisma } from '../../lib/prisma';
import { getLogger } from '../../lib/logger-context';
import { NotFoundError, ConflictError, BadRequestError } from '../../lib/errors';

const seasonSelect = {
  seasonsId: true,
  season: true,
  sort: true,
  created: true,
} as const;

const seasonSortFields: Record<string, string> = {
  seasons_id: 'seasonsId',
  season: 'season',
  sort: 'sort',
  created: 'created',
};

// Max rows one export may return, shared across modules. Exports over this are rejected,
// not truncated, so raise EXPORT_ROW_LIMIT in .env if a genuinely larger export is needed.
const EXPORT_ROW_LIMIT = Number(process.env.EXPORT_ROW_LIMIT) || 50000;

function buildSeasonsFilter(params: { search?: string; sortBy: string }) {
  const { search, sortBy } = params;

  return {
    where: search ? { season: { contains: search } } : {},
    sortField: seasonSortFields[sortBy] || 'sort',
  };
}

export async function getSeasons(params: {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const { page, pageSize, search, sortBy = 'sort', sortOrder = 'asc' } = params;

  getLogger('seasons-service').info(
    { page, pageSize, search, sortBy, sortOrder },
    'fetching seasons'
  );

  const { where, sortField } = buildSeasonsFilter({ search, sortBy });

  try {
    const [total, seasons] = await Promise.all([
      prisma.season.count({ where }),
      prisma.season.findMany({
        where,
        select: seasonSelect,
        orderBy: [{ [sortField]: sortOrder }, { seasonsId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    getLogger('seasons-service').info({ total, count: seasons.length }, 'seasons fetched');

    return {
      data: seasons,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  } catch (error) {
    getLogger('seasons-service').error(
      { err: error, page, pageSize, search, sortBy, sortOrder },
      'failed to fetch seasons'
    );
    throw new Error('Internal Server Error');
  }
}

export async function getSeasonsForExport(params: {
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  const { search, sortBy = 'sort', sortOrder = 'asc' } = params;

  getLogger('seasons-service').info({ search, sortBy, sortOrder }, 'fetching seasons for export');

  const { where, sortField } = buildSeasonsFilter({ search, sortBy });

  try {
    const total = await prisma.season.count({ where });

    if (total > EXPORT_ROW_LIMIT) {
      getLogger('seasons-service').warn(
        { total, limit: EXPORT_ROW_LIMIT, search },
        'export blocked, row count over limit'
      );
      throw new BadRequestError(
        `This export matches ${total} seasons, which is over the ${EXPORT_ROW_LIMIT} row limit. ` +
          'Narrow your search or filters and try again.'
      );
    }

    const seasons = await prisma.season.findMany({
      where,
      select: seasonSelect,
      orderBy: [{ [sortField]: sortOrder }, { seasonsId: 'asc' }],
      take: EXPORT_ROW_LIMIT,
    });

    getLogger('seasons-service').info({ count: seasons.length }, 'seasons for export fetched');

    return seasons;
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }
    getLogger('seasons-service').error(
      { err: error, search, sortBy, sortOrder },
      'failed to fetch seasons for export'
    );
    throw new Error('Internal Server Error');
  }
}

export async function getSeasonById(id: number) {
  getLogger('seasons-service').info({ id }, 'fetching season');

  try {
    const season = await prisma.season.findUnique({
      where: { seasonsId: id },
      select: seasonSelect,
    });

    if (!season) {
      throw new NotFoundError('Season');
    }

    getLogger('seasons-service').info({ id }, 'season fetched');

    return season;
  } catch (error) {
    if (error instanceof NotFoundError) {
      getLogger('seasons-service').warn({ id }, 'season not found');
      throw error;
    }
    getLogger('seasons-service').error({ err: error, id }, 'failed to fetch season');
    throw new Error('Internal Server Error');
  }
}

export async function getNextSort() {
  getLogger('seasons-service').info({}, 'fetching next sort value');

  try {
    const result = await prisma.season.aggregate({ _min: { sort: true } });
    const nextSort = (result._min.sort ?? 1) - 1;

    getLogger('seasons-service').info({ nextSort }, 'next sort value fetched');

    return { nextSort };
  } catch (error) {
    getLogger('seasons-service').error({ err: error }, 'failed to fetch next sort value');
    throw new Error('Internal Server Error');
  }
}

async function findDuplicateSeason(season: string, excludeId?: number) {
  return prisma.season.findFirst({
    where: {
      season,
      ...(excludeId ? { seasonsId: { not: excludeId } } : {}),
    },
    select: { seasonsId: true },
  });
}

export async function checkNameAvailable(season: string, excludeId?: number) {
  getLogger('seasons-service').info({ season, excludeId }, 'checking name availability');

  const trimmedSeason = season.trim();

  try {
    const existing = await findDuplicateSeason(trimmedSeason, excludeId);
    const available = existing === null;

    getLogger('seasons-service').info(
      { season: trimmedSeason, excludeId, available },
      'name availability checked'
    );

    return { available };
  } catch (error) {
    getLogger('seasons-service').error(
      { err: error, season: trimmedSeason, excludeId },
      'failed to check name availability'
    );
    throw new Error('Internal Server Error');
  }
}

export async function createSeason(data: { season: string; sort: number }) {
  const trimmedSeason = data.season.trim();

  getLogger('seasons-service').info({ season: trimmedSeason, sort: data.sort }, 'creating season');

  try {
    const duplicate = await findDuplicateSeason(trimmedSeason);

    if (duplicate) {
      getLogger('seasons-service').warn({ season: trimmedSeason }, 'duplicate season blocked');
      throw new ConflictError('This season already exists');
    }

    const newSeason = await prisma.season.create({
      data: {
        season: trimmedSeason,
        tescoSeasons: '',
        rueducommerceSeason: trimmedSeason,
        sort: data.sort,
      },
      select: { seasonsId: true },
    });

    getLogger('seasons-service').info(
      { seasonsId: newSeason.seasonsId, season: trimmedSeason },
      'season created'
    );

    return await getSeasonById(newSeason.seasonsId);
  } catch (error) {
    if (error instanceof ConflictError) {
      throw error;
    }
    getLogger('seasons-service').error(
      { err: error, season: trimmedSeason },
      'failed to create season'
    );
    throw new Error('Internal Server Error');
  }
}

export async function updateSeason(id: number, data: { season: string; sort: number }) {
  const trimmedSeason = data.season.trim();

  getLogger('seasons-service').info(
    { id, season: trimmedSeason, sort: data.sort },
    'updating season'
  );

  try {
    const existing = await getSeasonById(id);
    if (!existing) {
      throw new NotFoundError('Season');
    }

    const duplicate = await findDuplicateSeason(trimmedSeason, id);

    if (duplicate) {
      getLogger('seasons-service').warn({ id, season: trimmedSeason }, 'duplicate season blocked');
      throw new ConflictError('This season already exists');
    }

    await prisma.season.update({
      where: { seasonsId: id },
      data: { season: trimmedSeason, rueducommerceSeason: trimmedSeason, sort: data.sort },
      select: { seasonsId: true },
    });

    getLogger('seasons-service').info({ id, season: trimmedSeason }, 'season updated');

    return await getSeasonById(id);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }
    getLogger('seasons-service').error(
      { err: error, id, season: trimmedSeason },
      'failed to update season'
    );
    throw new Error('Internal Server Error');
  }
}

export async function deleteSeason(id: number) {
  getLogger('seasons-service').info({ id }, 'deleting season');

  try {
    const existing = await getSeasonById(id);

    await prisma.$transaction(async (tx) => {
      const [productCount, logCount] = await Promise.all([
        tx.productList.count({ where: { seasonsId: id } }),
        tx.smsProductsLog.count({ where: { seasonsId: id } }),
      ]);

      if (productCount > 0 || logCount > 0) {
        getLogger('seasons-service').warn(
          { id, productCount, logCount },
          'delete blocked, season in use'
        );

        const parts: string[] = [];
        if (productCount > 0) {
          parts.push(`${productCount} products`);
        }
        if (logCount > 0) {
          parts.push(`${logCount} product log entries`);
        }

        throw new ConflictError(
          `Cannot delete '${existing.season}': it is used by ${parts.join(' and ')}.`
        );
      }

      await tx.season.delete({ where: { seasonsId: id }, select: { seasonsId: true } });
    });

    getLogger('seasons-service').info({ id }, 'season deleted');

    return { status: 'Deleted' };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      throw error;
    }
    getLogger('seasons-service').error({ err: error, id }, 'failed to delete season');
    throw new Error('Internal Server Error');
  }
}
