import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@repo/database";
import { DockyardPermissions } from "@repo/rbac";
import { requireAuth } from "../../middleware/auth";
import { authorize } from "../../middleware/rbac";


export const createDockyardSchema = z.object({
    id: z.string().min()
})

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phoneNumber: z.string().min(6).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const dockyardRoutes: FastifyPluginAsync = async (app)=>{
    // GET DOCKYARDS

    app.get(
        "/",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.READ_ANY})
            ]
        }, async (_request, reply)=>{
            const dockyards = await prisma.dockyards.findMany({
                orderBy: {createdAt: "desc"},
                include: {
                    apiKeys: false
                }
            })

            return reply.send({success:"true", data: dockyards});
        }
    )
    app.get(
        "/active",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.READ_ANY})
            ]
        }, async (_request, reply)=>{
            const dockyards = await prisma.dockyards.findMany({
                where: {status:"ACTIVE"},
                orderBy: {createdAt: "desc"},
                include: {
                    apiKeys: false
                }
            })

            return reply.send({success:"true", data: dockyards});
        }
    )
    app.get(
        "/inactive",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.READ_ANY})
            ]
        }, async (_request, reply)=>{
            const dockyards = await prisma.dockyards.findMany({
                where: {status:"INACTIVE"},
                orderBy: {createdAt: "desc"},
                include: {
                    apiKeys: false
                }
            })

            return reply.send({success:"true", data: dockyards});
        }
    )
    app.get(
        "/incustody",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.READ_ANY})
            ]
        }, async (_request, reply)=>{
            const dockyards = await prisma.dockyards.findMany({
                where: {status:"INCUSTODY"},
                orderBy: {createdAt: "desc"},
                include: {
                    apiKeys: false
                }
            })

            return reply.send({success:"true", data: dockyards});
        }
    )
    app.get(
        "/suspended",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.READ_ANY})
            ]
        }, async (_request, reply)=>{
            const dockyards = await prisma.dockyards.findMany({
                where: {status:"SUSPENDED"},
                orderBy: {createdAt: "desc"},
                include: {
                    apiKeys: false
                }
            })

            return reply.send({success:"true", data: dockyards});
        }
    )

    // POST DOCKYARD

    app.post(
        "/",
        {
            preHandler:[
                requireAuth,
                authorize({permission: DockyardPermissions.CREATE_ANY})
            ]
        }, async (request,reply)=>{
            const data = createDockyardSchema.safeParse(request.body)
            if(!data.success){
                return reply.status(400).send({error:data.error.flatten()})
            }


        }
    )
}