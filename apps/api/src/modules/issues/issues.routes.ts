import { FastifyPluginAsync } from 'fastify';
import { getLogger } from '../../lib/logger-context';
import * as service from './issues.service';
import { createIssueSchema, issueIdSchema, listIssueSchema } from './issues.schema';

export const issueRoutes: FastifyPluginAsync = async (app) => {
  //GET get all issues
  app.get('/', { preHandler: [app.requirePermission('issues:view')] }, async (request, reply) => {
    getLogger('issues-request').info(
      { method: 'GET', url: request.url, query: request.query },
      'incoming request'
    );

    try {
      const query = listIssueSchema.parse(request.query);
      const result = await service.listIssues(query);

      getLogger('issues-response').info(
        { status: 200, total: result.meta.total },
        'issues fetched successfully'
      );

      return reply.send({
        data: result.data,
        meta: result.meta,
      });
    } catch (err) {
      getLogger('issues-response').error({ err }, 'failed to fetch issues');
      throw err;
    }
  });

  //POST create issues(issue book)
  app.post(
    '/',
    { preHandler: [app.requirePermission('issues:create')] },
    async (request, reply) => {
      getLogger('issues-request').info(
        { method: 'POST', url: request.url, query: request.query },
        'incoming request'
      );

      try {
        const input = createIssueSchema.parse(request.body);
        const issue = await service.createIssue(input);

        getLogger('issues-reponse').info(
          { status: 201, bookId: issue.bookId, studentId: issue.studentId },
          'Issue created successfully'
        );

        return reply.status(201).send({ data: issue });
      } catch (err) {
        getLogger('issues-reponse').error({ err }, 'failed to create issue');
        throw err;
      }
    }
  );

  //PATCH return issues(return book)
  app.patch(
    '/:id/return',
    { preHandler: [app.requirePermission('issues:edit')] },
    async (request, reply) => {
      getLogger('issues-request').info(
        { method: 'PATCH', url: request.url, body: request.body },
        'incoming request'
      );

      try {
        const { id } = issueIdSchema.parse(request.params);
        const result = service.returnIssue(id);

        getLogger('issues-response').info(
          { status: 200, IssueId: id },
          'Issue return successfully'
        );

        return reply.status(200).send({ data: result });
      } catch (err) {
        getLogger('issues-response').error({ err }, 'failed to return book');
        throw err;
      }
    }
  );
};
