import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  acceptGroupInvite, approveMember, createGroup, createGroupInvite, createGroupRole,
  deleteGroupRole, groupInviteInfo, listGroupMembers, listGroupRoles, listGroups,
  memberPermissions, removeGroupMember, setGroupMemberRole, setGroupMemberRoleDef,
  updateGroupRole, type RoleDefInput,
} from './groupService.js';

interface GroupParams {
  groupId: string;
}

/** Dashboard-level routes: group list/create + invite lookup/accept (not group-scoped). */
export function registerGroupRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/api/groups', async (req) => ({ groups: await listGroups(prisma, req.user!.id) }));

  app.post<{ Body: { name?: string; roles?: RoleDefInput[] } | null }>('/api/groups', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (name.length === 0) return reply.code(400).send({ error: 'grup adı gerekli' });
    if (name.length > 80) return reply.code(400).send({ error: 'grup adı en fazla 80 karakter olabilir' });
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.slice(0, 20) : [];
    return { group: await createGroup(prisma, name, req.user!.id, roles) };
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
  /** admin ya da üye yönetme yetkili rol. */
  const requireManageMembers = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (req.groupRole === 'admin' && req.groupStatus === 'approved') return true;
    const perms = await memberPermissions(prisma, (req.params as GroupParams).groupId, req.user!.id);
    if (!perms?.canManageMembers) {
      reply.code(403).send({ error: 'bu işlem için üye yönetme yetkisi gerekli' });
      return false;
    }
    return true;
  };
  /** admin ya da rol yönetme yetkili rol. */
  const requireManageRoles = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (req.groupRole === 'admin' && req.groupStatus === 'approved') return true;
    const perms = await memberPermissions(prisma, (req.params as GroupParams).groupId, req.user!.id);
    if (!perms?.canManageRoles) {
      reply.code(403).send({ error: 'bu işlem için rol yönetme yetkisi gerekli' });
      return false;
    }
    return true;
  };

  app.get<{ Params: GroupParams }>('/members', async (req, reply) => {
    if (!(await requireManageMembers(req, reply))) return;
    return { members: await listGroupMembers(prisma, req.params.groupId) };
  });

  app.patch<{
    Params: GroupParams & { userId: string };
    Body: { status?: string; role?: string; roleDefId?: string | null };
  }>('/members/:userId', async (req, reply) => {
    if (!(await requireManageMembers(req, reply))) return;
    const { groupId, userId } = req.params;
    if (req.body?.status === 'approved') {
      const result = await approveMember(prisma, groupId, userId);
      if ('error' in result) return reply.code(400).send(result);
      return { members: result };
    }
    if (req.body?.role === 'admin' || req.body?.role === 'member') {
      // admin/member ayrımı güvenlik çıpası olarak kalır; yalnızca adminler değiştirebilir.
      if (req.groupRole !== 'admin')
        return reply.code(403).send({ error: 'yönetici atamasını yalnızca grup yöneticisi yapabilir' });
      const result = await setGroupMemberRole(prisma, groupId, userId, req.body.role);
      if ('error' in result) return reply.code(400).send(result);
      return { members: result };
    }
    if (req.body?.roleDefId !== undefined) {
      const result = await setGroupMemberRoleDef(prisma, groupId, userId, req.body.roleDefId);
      if ('error' in result) return reply.code(400).send(result);
      return { members: result };
    }
    return reply.code(400).send({ error: "status 'approved', role 'admin'/'member' ya da roleDefId olmalı" });
  });

  app.delete<{ Params: GroupParams & { userId: string } }>('/members/:userId', async (req, reply) => {
    if (!(await requireManageMembers(req, reply))) return;
    const result = await removeGroupMember(prisma, req.params.groupId, req.params.userId);
    if ('error' in result) return reply.code(400).send(result);
    return { members: result };
  });

  app.post<{ Params: GroupParams }>('/invites', async (req, reply) => {
    if (!(await requireManageMembers(req, reply))) return;
    return { token: await createGroupInvite(prisma, req.params.groupId, req.user!.id) };
  });

  // ---------- Özel roller ----------

  app.get<{ Params: GroupParams }>('/roles', async (req) => ({
    roles: await listGroupRoles(prisma, req.params.groupId),
  }));

  app.post<{ Params: GroupParams; Body: RoleDefInput | null }>('/roles', async (req, reply) => {
    if (!(await requireManageRoles(req, reply))) return;
    const result = await createGroupRole(prisma, req.params.groupId, {
      name: req.body?.name ?? '',
      canManageMembers: req.body?.canManageMembers,
      canManageRoles: req.body?.canManageRoles,
      canCreateCanvas: req.body?.canCreateCanvas,
      defaultCanvasAccess: req.body?.defaultCanvasAccess,
    });
    if ('error' in result) return reply.code(400).send(result);
    return { role: result };
  });

  app.patch<{ Params: GroupParams & { roleId: string }; Body: Partial<RoleDefInput> | null }>(
    '/roles/:roleId',
    async (req, reply) => {
      if (!(await requireManageRoles(req, reply))) return;
      const result = await updateGroupRole(prisma, req.params.groupId, req.params.roleId, req.body ?? {});
      if ('error' in result) return reply.code(404).send(result);
      return { role: result };
    },
  );

  app.delete<{ Params: GroupParams & { roleId: string } }>('/roles/:roleId', async (req, reply) => {
    if (!(await requireManageRoles(req, reply))) return;
    if (!(await deleteGroupRole(prisma, req.params.groupId, req.params.roleId)))
      return reply.code(404).send({ error: 'rol bulunamadı' });
    return { ok: true };
  });
}
