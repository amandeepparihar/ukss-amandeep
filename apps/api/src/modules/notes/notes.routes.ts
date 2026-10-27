import type { FastifyPluginAsync } from "fastify";
import { createNoteSchema } from "./notes.schema";
import { NotesService } from "./notes.service";


export const notesRoutes: FastifyPluginAsync = async(app) => {
    const notesService = new NotesService();

    app.get('/', {
        preHandler: [app.authenticate]
    }, async() => {
        const notes = await notesService.findAll();
        return {data: notes};
    })

    app.post('/', {
        preHandler: [app.authenticate]
    }, async(request, reply) => {
        const data = createNoteSchema.parse(request.body);
        const note = await notesService.create(data);
        return reply.status(201).send({data: note});
    })
}