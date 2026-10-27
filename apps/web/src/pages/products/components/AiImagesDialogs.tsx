/**
 * AiImagesSection — composer for all Step 3 dialogs. Split into two files to
 * keep each under 400 lines (no behaviour change): enhance/lightbox dialogs and
 * crop/background-removal dialogs.
 */

import { AiImagesEnhanceDialogs } from './AiImagesEnhanceDialogs';
import { AiImagesCropBgDialogs } from './AiImagesCropBgDialogs';
import type { AiImagesController } from './useAiImagesSection';

export function AiImagesDialogs({ ctrl }: { ctrl: AiImagesController }) {
  return (
    <>
      <AiImagesEnhanceDialogs ctrl={ctrl} />
      <AiImagesCropBgDialogs ctrl={ctrl} />
    </>
  );
}
