/**
 * Singleton instance of SharedSessionService.
 * Import this instead of creating new instances in each route file.
 */
import { SharedSessionService } from './shared-session.service';

export const sharedSessionService = new SharedSessionService();
