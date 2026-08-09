import { create } from 'zustand';
import type { GroupInfo, GroupMemberInfo, GroupRole, GroupType } from '@co-pronoia/shared';
import { ApiError, groupApi, type RoleDefInput } from '../api/client';

interface GroupStore {
  groups: GroupInfo[];
  listLoaded: boolean;
  error: string | null;

  loadGroups: () => Promise<void>;
  createGroup: (name: string, roles?: RoleDefInput[], type?: GroupType) => Promise<GroupInfo | null>;
  /** Mints an invite token and returns the shareable URL. */
  inviteLink: (groupId: string) => Promise<string | null>;
  joinByToken: (token: string, jobTitle: string) => Promise<GroupInfo | null>;
  loadMembers: (groupId: string) => Promise<GroupMemberInfo[]>;
  approveMember: (groupId: string, userId: string) => Promise<GroupMemberInfo[] | null>;
  setMemberRole: (groupId: string, userId: string, role: GroupRole) => Promise<GroupMemberInfo[] | null>;
  removeMember: (groupId: string, userId: string) => Promise<GroupMemberInfo[] | null>;
  clearError: () => void;
  reset: () => void;
}

export const useGroupStore = create<GroupStore>((set) => ({
  groups: [],
  listLoaded: false,
  error: null,

  loadGroups: async () => {
    try {
      const { groups } = await groupApi.list();
      set({ groups, listLoaded: true });
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err), listLoaded: true });
    }
  },

  createGroup: async (name, roles, type) => {
    try {
      const { group } = await groupApi.create(name, roles, type);
      set((s) => ({ groups: [group, ...s.groups] }));
      return group;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  inviteLink: async (groupId) => {
    try {
      const { token } = await groupApi.createInvite(groupId);
      return `${window.location.origin}/?grupDavet=${token}`;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  joinByToken: async (token, jobTitle) => {
    try {
      const { group } = await groupApi.acceptInvite(token, jobTitle);
      set((s) => ({
        groups: s.groups.some((g) => g.id === group.id) ? s.groups : [group, ...s.groups],
      }));
      return group;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  loadMembers: async (groupId) => {
    try {
      const { members } = await groupApi.members(groupId);
      return members;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return [];
    }
  },

  approveMember: async (groupId, userId) => {
    try {
      return (await groupApi.approveMember(groupId, userId)).members;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  setMemberRole: async (groupId, userId, role) => {
    try {
      const { members } = await groupApi.setMemberRole(groupId, userId, role);
      return members;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  removeMember: async (groupId, userId) => {
    try {
      return (await groupApi.removeMember(groupId, userId)).members;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set({ groups: [], listLoaded: false, error: null }),
}));
