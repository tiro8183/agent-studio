import type { CurrentUser } from '../types/domain';

export interface WorkspacePageContext {
  currentUser?: CurrentUser | null;
}
