import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  acceptGroupInvite, approveMember, createGroup, createGroupInvite, groupInviteInfo,
  listGroupMembers, listGroups, removeGroupMember, setGroupMemberRole,
} from './groupService.js';

interface GroupParams {
  groupId: string;
}

/** Dashboard-level routes: group list/create + invite lookup/accept (not group-scoped). */
export function registerGroupRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/api/groups', async (req) => ({ groups: await listGroups(prisma, req.user!.id) }));

  app.post<{ Body: { name?: string } | null }>('/api/groups', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (name.length === 0) return reply.code(400).send({ error: 'grup adı gerekli' });
    if (name.length > 80) return reply.code(400).send({ error: 'grup adı en fazla 80 karakter olabilir' });
    return { group: await createGroup(prisma, name, req.user!.id) };
  });

  app.get<{ Params: { token: string } }>('/api/group-invites/:token', async (req, reply) => {
    const invite = await groupInviteInfo(prisma, req.params.token);
    if (!invite) return reply.code(404).send({ error: 'davet linki geçersiz' });
    return { groupName: invite.group.name, invitedBy: invite.creator.username };
  });

  app.post<{ Params: { token: string }; Body: { jobTitle?: string } | null }>(
    '/api/group-invites/:token/accept',
    async (req, reply) => {
      const jobTitle = (req.body?.jobTitle ?? '').trim();
      const group = await acceptGroupInvite(prisma, req.params.token, req.user!.id, jobTitle);
      if (!group) return reply.code(404).send({ error: 'davet linki geçersiz' });
      return { group };
    },
  );
}

/**
 * Group-scoped member-management routes. Registered under `/api/groups/:groupId`;
 * a preHandler in app.ts has already resolved `req.groupRole`/`req.groupStatus`.
 */
export function registerGroupMemberRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.groupRole !== 'admin') {
      reply.code(403).send({ error: 'bu işlemi yalnızca grup yöneticisi yapabilir' });
      return false;
    }
    return true;
  };

  app.get<{ Params: GroupParams }>('/members', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { members: await listGroupMembers(prisma, req.params.groupId) };
  });

  app.patch<{ Params: GroupParams & { userId: string }; Body: { status?: string; role?: string } }>(
    '/members/:userId',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const { groupId, userId } = req.params;
      if (req.body?.status === 'approved') {
        const result = await approveMember(prisma, groupId, userId);
        if ('error' in result) return reply.code(400).send(result);
        return { members: result };
      }
      if (req.body?.role === 'admin' || req.body?.role === 'member') {
        const result = await setGroupMemberRole(prisma, groupId, userId, req.body.role);
        if ('error' in result) return reply.code(400).send(result);
        return { members: result };
      }
      return reply.code(400).send({ error: "status 'approved' veya role 'admin'/'member' olmalı" });
    },
  );

  app.delete<{ Params: GroupParams & { userId: string } }>('/members/:userId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const result = await removeGroupMember(prisma, req.params.groupId, req.params.userId);
    if ('error' in result) return reply.code(400).send(result);
    return { members: result };
  });

  app.post<{ Params: GroupParams }>('/invites', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { token: await createGroupInvite(prisma, req.params.groupId, req.user!.id) };
  });
}
