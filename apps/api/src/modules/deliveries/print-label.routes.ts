/**
 * Deliveries grid "Print Label" context-menu action.
 *
 *   POST /api/deliveries/print-label          — resolve grid cells server-side
 *                                               and stream a native pdfkit A4
 *                                               PDF (one page per cell) with
 *                                               bwip-js Code128 barcodes.
 *                                               Replaces the legacy
 *                                               ProductsBarcodeController::label
 *                                               grid path.
 *
 *   GET  /api/deliveries/print-label/:filename — serves a single label PDF
 *                                               inline for a plain
 *                                               `window.open()` navigation.
 *                                               Auth is the ambient
 *                                               `shared_admin_session` cookie
 *                                               (path '/', sent on every
 *                                               request, already the app-wide
 *                                               cross-app session-liveness
 *                                               signal used by
 *                                               plugins/auth.ts) rather than
 *                                               the in-memory JWT bearer
 *                                               token, since a browser tab
 *                                               navigation can't carry an
 *                                               Authorization header. This
 *                                               matches the legacy app: being
 *                                               logged into the browser once
 *                                               is enough, no extra login or
 *                                               token round trip required.
 *
 * Permission gate: `deliveries:view` for both routes (same as the rest of the
 * deliveries read surface). Registered as a child plugin in
 * deliveries.routes.ts.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { SharedSessionService } from '../auth/shared-session.service';
import {
  resolveLabelItem,
  generateLabelPdf,
  markLabelGenerated,
  LabelResolutionError,
  type PrintLabelItemInput,
  type ResolvedLabelItem,
} from './print-label.service';

const PrintLabelItemSchema = z.object({
  productListsId: z.number().int().positive(),
  boxCode: z.string().min(1).max(64),
  sizeOptionId: z.number().int().positive(),
});

const PrintLabelBodySchema = z.object({
  items: z.array(PrintLabelItemSchema).min(1).max(200),
});

const PrintLabelBoxQuerySchema = z.object({
  boxCode: z.string().min(1).max(64),
  sizeId: z.coerce.number().int().positive(),
});

// Path param filename must look like invoice_<digits>_<digits>.pdf (legacy
// parity: products_barcode_controller.php:805 `invoice_<product_lists_id>_<sizeId>`).
const INVOICE_FILENAME_RE = /^invoice_(\d+)_(\d+)\.pdf$/i;

const sharedSessionService = new SharedSessionService();

/**
 * Ambient auth for the plain-navigation GET route below: reuses the
 * shared_admin_session cookie (already sent on every request, path '/',
 * already the app-wide cross-app session-liveness signal checked by
 * plugins/auth.ts's `authenticate`) instead of a per-request token, since a
 * window.open() navigation cannot carry the in-memory JWT bearer token.
 */
async function getDeliveriesViewUserId(request: FastifyRequest): Promise<string | null> {
  const sharedToken = request.cookies.shared_admin_session;
  if (!sharedToken) return null;

  const validated = await sharedSessionService.validateSession(sharedToken);
  if (!validated?.nodeUserId) return null;

  const user = await prisma.user.findUnique({
    where: { id: validated.nodeUserId },
    include: { role: { include: { permissions: true } } },
  });
  if (!user || !user.isActive) return null;

  const permissions = user.role.permissions.map((p) => `${p.resource}:${p.action}`);
  if (!permissions.includes('deliveries:view')) return null;

  return user.id;
}

export const printLabelRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/print-label',
    { preHandler: [app.requirePermission('deliveries:view')] },
    async (request, reply) => {
      let body: z.infer<typeof PrintLabelBodySchema>;
      try {
        body = PrintLabelBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({
            status: 'error',
            message: 'Invalid request body',
            details: err.errors,
          });
        }
        throw err;
      }

      // 1. Resolve every item FIRST — never render a partial PDF. Collect
      //    per-item failures so the operator sees exactly which cells broke.
      const resolved: ResolvedLabelItem[] = [];
      const failures: Array<{ item: PrintLabelItemInput; message: string }> = [];
      for (const input of body.items) {
        try {
          resolved.push(await resolveLabelItem(input));
        } catch (err) {
          if (err instanceof LabelResolutionError) {
            failures.push({ item: err.input, message: err.message });
          } else {
            // Unexpected error — surface as 500 via Fastify's error handler.
            request.log.error(
              { err: (err as Error).message, input },
              'print-label: unexpected resolution error'
            );
            return reply.status(500).send({
              status: 'error',
              message: 'Label resolution failed',
            });
          }
        }
      }
      if (failures.length > 0) {
        return reply.status(422).send({
          status: 'error',
          message:
            'One or more items could not be resolved to a product quantity row.',
          failures,
        });
      }

      // 2. Render the PDF (all items resolved).
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await generateLabelPdf(resolved);
      } catch (err) {
        request.log.error({ err: (err as Error).message }, 'print-label: PDF generation failed');
        return reply.status(500).send({
          status: 'error',
          message: 'PDF generation failed',
        });
      }

      // 3. Stream the PDF FIRST so the operator gets it immediately. The buffer
      //    is already fully rendered (generateLabelPdf resolved above), so the
      //    "flags only after successful render" guarantee is intact.
      //    No Content-Disposition (deliberately not a download).
      reply.header('Content-Type', 'application/pdf').send(pdfBuffer);

      // 4. Audit flags — best-effort, NON-BLOCKING. For a 200-item bulk print
      //    this avoids making the operator wait on up to 200 sequential UPDATEs
      //    before the PDF arrives. markLabelGenerated does not touch `reply`
      //    (so it cannot throw into the already-sent response) and catches each
      //    UPDATE internally; the trailing .catch is a process-safety net so an
      //    unexpected rejection cannot crash the server (Node 15+ treats
      //    unhandled rejections as fatal by default).
      //    isBulk = items.length > 1: single → is_label_generated,
      //    multi → is_bulk_label_generated.
      void markLabelGenerated(resolved, resolved.length > 1).catch((err) => {
        request.log.error(
          { err: (err as Error).message },
          'print-label: markLabelGenerated unexpected failure (best-effort)'
        );
      });
      return reply;
    }
  );

  // ---------------------------------------------------------------------
  // GET /print-label/:filename — serves the single-label PDF inline for a
  // plain window.open() navigation. Authenticated via the ambient
  // shared_admin_session cookie (see getDeliveriesViewUserId above) rather
  // than app.requirePermission, since a browser tab navigation cannot carry
  // the in-memory JWT's Authorization header.
  //
  // The grid only knows the default size bucket (`sizeId` query param) at
  // click time — the true per-product `products_options_values_id` is only
  // knowable after resolving the row server-side. So the path's filename
  // number (parsed below as `filenameSizeId`) is a cosmetic guess, not
  // authoritative: once resolved, if it doesn't match the row's real
  // `sizeOptionValueId`, the route redirects once to the corrected URL
  // rather than serving a mislabeled PDF. The redirect preserves `sizeId` in
  // the query, so the second request resolves the same row and matches —
  // terminating in at most 2 requests, no redirect loop.
  // ---------------------------------------------------------------------
  app.get('/print-label/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const match = INVOICE_FILENAME_RE.exec(filename);
    if (!match) {
      return reply.status(400).send({ status: 'error', message: 'Invalid label filename' });
    }

    let query: z.infer<typeof PrintLabelBoxQuerySchema>;
    try {
      query = PrintLabelBoxQuerySchema.parse(request.query);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          status: 'error',
          message: 'Invalid request query',
          details: err.errors,
        });
      }
      throw err;
    }

    const userId = await getDeliveriesViewUserId(request);
    if (!userId) {
      return reply.status(401).send({ status: 'error', message: 'Not authenticated' });
    }

    const productListsId = Number(match[1]);
    // Cosmetic only — the path's filename number, parsed from the URL the
    // frontend guessed at click time. NOT used to resolve the row; see the
    // comment above this route.
    const filenameSizeId = Number(match[2]);

    let resolved: ResolvedLabelItem;
    try {
      resolved = await resolveLabelItem({
        productListsId,
        boxCode: query.boxCode,
        sizeOptionId: query.sizeId,
      });
    } catch (err) {
      if (err instanceof LabelResolutionError) {
        return reply.status(422).send({ status: 'error', message: err.message });
      }
      request.log.error(
        { err: (err as Error).message, productListsId, sizeId: query.sizeId, boxCode: query.boxCode },
        'print-label/:filename: unexpected resolution error'
      );
      return reply.status(500).send({
        status: 'error',
        message: 'Label resolution failed',
      });
    }

    // The grid's default bucket id doesn't always match this product's real
    // option-value id (see module doc comment). When they differ, the path's
    // filename number is stale — self-correct with a redirect instead of
    // rendering a PDF under the wrong filename this round.
    if (resolved.sizeOptionValueId !== filenameSizeId) {
      const correctedFilename = `invoice_${productListsId}_${resolved.sizeOptionValueId}.pdf`;
      const correctedUrl = `/api/deliveries/print-label/${correctedFilename}?boxCode=${encodeURIComponent(query.boxCode)}&sizeId=${query.sizeId}`;
      return reply.redirect(302, correctedUrl);
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateLabelPdf([resolved]);
    } catch (err) {
      request.log.error(
        { err: (err as Error).message },
        'print-label/:filename: PDF generation failed'
      );
      return reply.status(500).send({
        status: 'error',
        message: 'PDF generation failed',
      });
    }

    // Unlike the bulk POST route above, this DOES set Content-Disposition —
    // this route needs the browser's inline PDF viewer to know the real
    // filename for its Save action (that's the whole point of this route).
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(pdfBuffer);

    void markLabelGenerated([resolved], false).catch((err) => {
      request.log.error(
        { err: (err as Error).message },
        'print-label/:filename: markLabelGenerated unexpected failure (best-effort)'
      );
    });
    return reply;
  });
};
