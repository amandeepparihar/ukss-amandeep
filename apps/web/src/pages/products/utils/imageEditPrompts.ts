/**
 * Builds the AI-edit preset prompts shown in the per-image enhance dialog.
 *
 * The prompt is parameterised on `productTypeName` from `productTypesData` so a
 * new product type added to the lookup table works automatically — no code
 * change needed.
 *
 * Reusable: any other surface that wants the same context-aware presets
 * (bulk-enhance dialog, batch tooling, etc.) imports `buildImageEditPrompts`.
 */

export interface ImageEditPromptContext {
  /** From `productTypesData` (e.g. "Football Shirt", "Shorts", "Tracksuit"). */
  productTypeName?: string | null;
  /** Free-form product name — currently unused, kept for caller compatibility. */
  productName?: string | null;
  /** Team / club name, e.g. "Real Madrid". Optional. */
  teamName?: string | null;
  /** Season string, e.g. "24-25". Optional — included for prompt grounding. */
  season?: string | null;
}

export interface ImageEditPreset {
  label: string;
  prompt: string;
}

function viewingAngleClause(): string {
  return 'front-facing view, centred in frame, no side angle, no back view, no rotation';
}

function backgroundClause(): string {
  return 'pure white background, soft uniform lighting, no shadows on the floor';
}

/**
 * Returns the preset prompts for the AI-edit picker.
 * Each prompt is a complete instruction the user can apply as-is or tweak.
 */
export function buildImageEditPrompts(ctx: ImageEditPromptContext): ImageEditPreset[] {
  const typeLabel = ctx.productTypeName?.trim() || 'product';
  const keep = `the ${typeLabel.toLowerCase()} only — no person, no mannequin, no other garments`;
  const angle = viewingAngleClause();
  const bg = backgroundClause();

  return [
    {
      label: `Studio shot — ${typeLabel}`,
      prompt: `Studio product shot of ${keep}. ${angle}. ${bg}. Sharp, high resolution, accurate colours, no text overlays.`,
    },
    {
      label: `Ghost mannequin — ${typeLabel}`,
      prompt: `Ghost-mannequin edit: remove the person, mannequin, and any other clothing. Keep ${keep}. ${angle}. ${bg}. Preserve fabric texture, stitching, badges, and sponsor prints.`,
    },
  ];
}
