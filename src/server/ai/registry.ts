import type { ToolDefinition, Surface, Tier } from './types';
import { workshopPing } from './tools/workshop-ping';
import {
  workshopCreate,
  workshopUpdate,
  workshopPublish,
  workshopArchive,
} from './tools/workshops';
import { contentLocalize, contentMarkReviewed, contentGenerate } from './tools/content';
import { cohortCreate, cohortClone, cohortCancel } from './tools/cohorts';
import { sessionUpdateAgenda } from './tools/sessions';
import { waitlistPromote } from './tools/waitlist';

// The server-side tool registry: name → definition. This is the authority for
// which tools exist, their tier, and which surfaces may call them. Agents and
// UI both resolve tools here; there is no other path to execution.
const REGISTRY = new Map<string, ToolDefinition>();

function register<I, O>(def: ToolDefinition<I, O>): void {
  if (REGISTRY.has(def.name)) throw new Error(`Duplicate tool: ${def.name}`);
  REGISTRY.set(def.name, def as unknown as ToolDefinition);
}

register(workshopPing);
// M1 — workshop lifecycle (COPILOT_TOOLS §1)
register(workshopCreate);
register(workshopUpdate);
register(workshopPublish);
register(workshopArchive);
register(cohortCreate);
register(cohortClone);
register(cohortCancel);
register(sessionUpdateAgenda);
register(waitlistPromote);
// M1 — content & localization (COPILOT_TOOLS §2)
register(contentGenerate);
register(contentLocalize);
register(contentMarkReviewed);

export class ToolError extends Error {
  constructor(
    public code: 'unknown_tool' | 'surface_forbidden' | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function getTool(name: string): ToolDefinition {
  const def = REGISTRY.get(name);
  if (!def) throw new ToolError('unknown_tool', `Unknown tool: ${name}`);
  return def;
}

export function toolTier(name: string): Tier {
  return getTool(name).tier;
}

/** Enforces the concierge's restricted subset et al. (invariant 7). */
export function assertSurfaceAllowed(name: string, surface: Surface): ToolDefinition {
  const def = getTool(name);
  if (!def.surfaces.includes(surface)) {
    throw new ToolError(
      'surface_forbidden',
      `Tool ${name} is not available on the ${surface} surface`,
    );
  }
  return def;
}

export function listTools(): ToolDefinition[] {
  return [...REGISTRY.values()];
}
