import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import {
  getListings,
  getListing,
  createListing,
  addReview,
  incrementDownloads,
  installListing,
  uninstallListing,
  getListingVersions,
  createListingVersion,
  rollbackListing,
  getCatalogValidationReport,
  updateListingReviewStatus,
  createMigrationDraft,
  createAllMigrationDrafts,
  applyMigration,
  applyAllMigrations,
  validateSkillStructure,
  getSkillContent,
} from '../marketplace-api.ts';
import { readJsonBody, RequestBodyTooLargeError } from '../ws-hub/context.ts';

export async function marketplaceHandler(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: typeof import('../ws-hub/context.ts'),
  headers: Record<string, string>,
): Promise<boolean> {
  // --- Marketplace Routes ---

  if (url.pathname === '/api/marketplace' && req.method === 'GET') {
    const listings = getListings();
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, data: listings, total: listings.length }));
    return true;
  }

  if (url.pathname === '/api/marketplace/validation' && req.method === 'GET') {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ success: true, data: getCatalogValidationReport() }));
    return true;
  }

  if (url.pathname === '/api/marketplace/migrations' && req.method === 'POST') {
    try {
      const payload = await readJsonBody<{ limit?: number }>(req);
      const result = createAllMigrationDrafts(Number(payload.limit || 250));
      res.writeHead(201, headers);
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (err) {
      res.writeHead(err instanceof RequestBodyTooLargeError ? 413 : 400, headers);
      res.end(
        JSON.stringify({
          success: false,
          error:
            err instanceof RequestBodyTooLargeError
              ? 'Request body too large'
              : err instanceof Error
                ? err.message
                : 'Migration failed',
        }),
      );
    }
    return true;
  }

  // Native migration engine: apply (not just draft) canonical structure to
  // every invalid catalog entry — bulk variant.
  if (url.pathname === '/api/marketplace/migrations/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        void applyAllMigrations(Number(payload.limit || 250))
          .then((result) => {
            res.writeHead(200, headers);
            res.end(JSON.stringify({ success: true, data: result }));
          })
          .catch((err: unknown) => {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : 'Apply migrations failed',
              }),
            );
          });
      } catch (err) {
        res.writeHead(400, headers);
        res.end(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : 'Apply migrations failed',
          }),
        );
      }
    });
    return true;
  }

  if (url.pathname === '/api/marketplace' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const missingFields: string[] = [];
        if (!payload.name) missingFields.push('name');
        if (!payload.description) missingFields.push('description');
        if (!payload.author) missingFields.push('author');
        if (!payload.skillContent) missingFields.push('skillContent');

        if (missingFields.length > 0) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: `Missing required fields: ${missingFields.join(', ')}`,
            }),
          );
          return;
        }

        const validation = validateSkillStructure(payload.skillContent);
        if (!validation.valid) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: 'Skill structure validation failed',
              details: validation.errors,
            }),
          );
          return;
        }

        const listing = createListing({
          name: payload.name,
          description: payload.description,
          author: payload.author,
          version: payload.version,
          tags: payload.tags,
          triggers: payload.triggers,
          agentType: payload.agentType,
          skillContent: payload.skillContent,
        });
        res.writeHead(201, headers);
        res.end(
          JSON.stringify({
            success: true,
            data: listing,
            message: `Skill '${payload.name}' created successfully`,
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create listing';
        const status = message.includes('already exists') ? 409 : 500;
        res.writeHead(status, headers);
        res.end(JSON.stringify({ success: false, error: message }));
      }
    });
    return true;
  }

  if (url.pathname === '/api/marketplace/validate/structure' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { skillContent } = JSON.parse(body);
        if (!skillContent) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({ success: false, error: 'Missing required field: skillContent' }),
          );
          return;
        }
        const result = validateSkillStructure(skillContent);
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, data: result }));
      } catch {
        res.writeHead(400, headers);
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return true;
  }

  // Match /api/marketplace/:id/review, /download, /install, /uninstall, /versions and /rollback
  const marketplaceMatch = url.pathname.match(
    /^\/api\/marketplace\/([^/]+)(?:\/(review|download|install|uninstall|versions|rollback|moderate|migrate|apply-migration))?$/,
  );
  if (marketplaceMatch) {
    const listingId = marketplaceMatch[1];
    const action = marketplaceMatch[2];

    if (action === 'versions' && req.method === 'GET') {
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: getListingVersions(listingId) }));
      return true;
    }

    if (action === 'versions' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const version = createListingVersion(listingId, payload.version, payload.content);
          res.writeHead(201, headers);
          res.end(JSON.stringify({ success: true, data: version }));
        } catch (err) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : 'Invalid version',
            }),
          );
        }
      });
      return true;
    }

    if (action === 'rollback' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const version = rollbackListing(listingId, payload.version);
          if (!version) {
            res.writeHead(404, headers);
            res.end(JSON.stringify({ success: false, error: 'Version not found' }));
            return;
          }
          res.writeHead(200, headers);
          res.end(JSON.stringify({ success: true, data: version }));
        } catch (err) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : 'Invalid rollback',
            }),
          );
        }
      });
      return true;
    }

    if (action === 'moderate' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (payload.status !== 'approved' && payload.status !== 'rejected')
            throw new Error('status must be approved or rejected');
          const listing = updateListingReviewStatus(listingId, payload.status);
          if (!listing) throw new Error('Listing not found or validation failed');
          res.writeHead(200, headers);
          res.end(JSON.stringify({ success: true, data: listing }));
        } catch (err) {
          res.writeHead(400, headers);
          res.end(
            JSON.stringify({
              success: false,
              error: err instanceof Error ? err.message : 'Invalid moderation',
            }),
          );
        }
      });
      return true;
    }

    if (action === 'migrate' && req.method === 'POST') {
      const draft = createMigrationDraft(listingId);
      if (!draft) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Listing content not found' }));
        return true;
      }
      res.writeHead(201, headers);
      res.end(JSON.stringify({ success: true, data: draft }));
      return true;
    }

    // Native migration: apply canonical structure directly to SKILL.md.
    if (action === 'apply-migration' && req.method === 'POST') {
      const result = applyMigration(listingId);
      if (!result) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Listing content not found' }));
        return true;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: result }));
      return true;
    }

    if (!action && req.method === 'GET') {
      const listing = getListing(listingId);
      if (!listing) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Listing not found' }));
        return true;
      }
      const content = listing.skillPath ? getSkillContent(listing.skillPath) : null;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: { ...listing, content } }));
      return true;
    }

    if (action === 'review' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { user, rating, comment } = JSON.parse(body);
          if (!user || rating === null || !comment) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: 'Missing required fields: user, rating, comment',
              }),
            );
            return;
          }
          if (typeof rating !== 'number' || rating < 1 || rating > 5) {
            res.writeHead(400, headers);
            res.end(
              JSON.stringify({
                success: false,
                error: 'Rating must be a number between 1 and 5',
              }),
            );
            return;
          }
          const review = addReview(listingId, { user, rating, comment });
          res.writeHead(201, headers);
          res.end(JSON.stringify({ success: true, data: review }));
        } catch {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return true;
    }

    if (action === 'download' && req.method === 'POST') {
      const downloads = incrementDownloads(listingId);
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: { id: listingId, downloads } }));
      return true;
    }

    if (action === 'install' && req.method === 'POST') {
      const installation = installListing(listingId);
      if (!installation) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Listing is not installable' }));
        return true;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: installation }));
      return true;
    }

    if (action === 'uninstall' && req.method === 'POST') {
      const removed = uninstallListing(listingId);
      if (!removed) {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ success: false, error: 'Listing is not installed' }));
        return true;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ success: true, data: { id: listingId, installed: false } }));
      return true;
    }

    res.writeHead(404, headers);
    res.end(JSON.stringify({ success: false, error: 'Route not found' }));
    return true;
  }

  return false;
}
