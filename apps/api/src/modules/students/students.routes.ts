import { FastifyPluginAsync } from 'fastify';
import { runWithExecution, getLogger } from '../../lib/logger-context';
import {
  createStudentSchema,
  listStudentsQuery,
  studentIdSchema,
  updateStudentSchema,
} from './students.schema';
import * as service from './students.service';

export const studentRoutes: FastifyPluginAsync = async (app) => {
  //GET all students
  app.get(
    '/',
    {
      preHandler: [app.requirePermission('students:view')],
    },
    async (request, reply) => {
      getLogger('students-request').info(
        { method: 'GET', url: request.url, query: request.query },
        'incoming request'
      );

      try {
        const query = listStudentsQuery.parse(request.query);
        const result = await service.listStudents(query);

        getLogger('students-reponse').info(
          { status: 200, total: result.meta.total },
          'students fetched successfully'
        );

        return reply.send({
          data: result.data,
          meta: result.meta,
        });
      } catch (err) {
        getLogger('students-reponse').error({ err }, 'failed to fetch students');
        throw err;
      }
    }
  );

  //GET student by id
  app.get(
    '/:id',
    { preHandler: [app.requirePermission('students:view')] },
    async (request, reply) => {
      getLogger('students-request').info(
        {
          method: 'GET',
          url: request.url,
          query: request.query,
        },
        'incoming request'
      );

      try {
        const { id } = studentIdSchema.parse(request.params);
        const result = await service.getStudent(id);

        getLogger('students-reponse').info({ status: 200 }, 'book fetched successfully');

        return reply.send({
          data: result,
        });
      } catch (err) {
        getLogger('student-reponse').error({ err }, 'failed to fetch students');
        throw err;
      }
    }
  );

  //POST create student
  app.post('/', { preHandler: [app.requirePermission('students:create')] }, async (request, reply) => {
    getLogger('students-request').info(
      { method: 'POST', url: request.url, query: request.query },
      'incoming request'
    );

    try {
      const input = createStudentSchema.parse(request.body);
      const student = await service.createStudent(input);

      getLogger('student-reponse').info(
        { status: 201, studentId: student.id },
        'student created successfully'
      );

      return reply.status(201).send({ data: student });
    } catch (err) {
      getLogger('student-response').error({ err }, 'failed to create student');
    }
  });

  //PUT update student
  app.put('/:id', { preHandler: [app.requirePermission('students:edit')] }, async (request, reply) => {
    getLogger('student-request').info(
      { method: 'PUT', url: request.url, body: request.body },
      'incoming request'
    );

    try {
      const { id } = studentIdSchema.parse(request.params);
      const input = updateStudentSchema.parse(request.body);
      const result = await service.updateStudent(id, input);

      getLogger('student-response').info(
        { status: 200, studentId: result.id },
        'student updated successfully'
      );

      return reply.status(200).send({ data: result });
    } catch (err) {
      getLogger('student-response').error({ err }, 'failed to update student');
      throw err;
    }
  });

  //DELETE student
  app.delete(
    '/:id',
    { preHandler: [app.requirePermission('students:delete')] },
    async (request, reply) => {
      getLogger('students').info(
        { method: 'DEL', url: request.url, body: request.body },
        'incoming request'
      );

      try {
        const { id } = studentIdSchema.parse(request.params);
        const result = await service.deleteStudent(id);

        getLogger('student').info({ status: 200, studentId: id }, 'student deleted successfully');

        return reply.status(200).send({ data: result });
      } catch (err) {
        getLogger('student-reponse').error({ err }, `failed to delete student`);
        throw err;
      }
    }
  );
};
