import { useEffect, useState, useCallback } from 'react';
import { Star, Download, Tag, User, Plus, X, AlertCircle, CheckCircle, SlidersHorizontal } from 'lucide-react';
import { useT } from '../hooks/useLocale';

interface SkillListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  reviews: Review[];
  tags: string[];
  triggers?: string[];
  agentType?: string;
  content?: string;
  reviewStatus?: 'legacy' | 'pending' | 'approved' | 'rejected';
  validation?: { valid: boolean; errors: string[] };
}

interface CatalogValidationReport {
  total: number;
  valid: number;
  invalid: number;
  entries: Array<{
    id: string;
    name: string;
    status?: string;
    validation?: { valid: boolean; errors: string[] };
  }>;
}

interface Review {
  id: string;
  user: string;
  rating: number;
  comment: string;
}

interface SubmitFormData {
  name: string;
  description: string;
  author: string;
  version: string;
  tags: string;
  triggers: string;
  agentType: string;
  skillContent: string;
}

type SortMode = 'relevance' | 'newest' | 'downloads' | 'rating' | 'name';

const API_BASE = '/api/marketplace';

const AGENT_TYPES = [
  'general',
  'doc-agent',
  'explore',
  'finance-agent',
  'gov-agent',
  'hr-agent',
  'legal-agent',
  'mkt-agent',
  'ops-agent',
  'sales-agent',
  'session-agent',
  'sdd-design',
  'sdd-apply',
  'sdd-explore',
  'sdd-verify',
  'any',
];

// Mirrors the server-side canonical section vocabulary (marketplace-api.ts).
const USAGE_HEADING_RE =
  /^##\s+(usage|when to use|uso|cuando usar|how to use|workflow|execution steps|activation contract|instructions|steps)\b/im;
const EXAMPLES_HEADING_RE =
  /^##\s+(examples?|ejemplos?|sample|samples|api reference|worked example)\b/im;

function validateSkillStructure(content: string): string[] {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    errors.push('SKILL.md content is empty');
    return errors;
  }
  if (!/^---/.test(content)) {
    errors.push('Missing YAML frontmatter (must start with ---)');
  }
  if (!USAGE_HEADING_RE.test(content)) {
    errors.push("Missing '## Usage' or '## When to Use' section");
  }
  if (!EXAMPLES_HEADING_RE.test(content)) {
    errors.push("Missing '## Examples' section");
  }
  if (content.includes('---')) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (match) {
      const fm = match[1];
      if (!/name:\s*\S/.test(fm)) {
        errors.push("Frontmatter missing 'name' field");
      }
      // Multi-line folded descriptions are valid YAML — only flag when the
      // key is entirely absent.
      if (!/^[ \t]*description:/m.test(fm)) {
        errors.push("Frontmatter missing 'description' field");
      }
    }
  }
  return errors;
}

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || 'API request failed');
  }
  return json.data;
}

export function Marketplace() {
  const { tt } = useT();
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [selectedListing, setSelectedListing] = useState<SkillListing | null>(null);
  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [agentFilter, setAgentFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitForm, setSubmitForm] = useState<SubmitFormData>({
    name: '',
    description: '',
    author: '',
    version: '1.0.0',
    tags: '',
    triggers: '',
    agentType: 'any',
    skillContent: '',
  });
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [catalogReport, setCatalogReport] = useState<CatalogValidationReport | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [migrationLoading, setMigrationLoading] = useState(false);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<SkillListing[]>(API_BASE);
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const loadCatalogReport = useCallback(async () => {
    try {
      setCatalogReport(await fetchApi<CatalogValidationReport>(`${API_BASE}/validation`));
    } catch (err) {
      setReviewMessage(err instanceof Error ? err.message : 'Failed to load catalog validation');
    }
  }, []);

  useEffect(() => {
    void loadCatalogReport();
  }, [loadCatalogReport]);

  const handleSubmit = async () => {
    setSubmitErrors([]);
    setSubmitSuccess(false);

    const missing: string[] = [];
    if (!submitForm.name) missing.push('name');
    if (!submitForm.description) missing.push('description');
    if (!submitForm.author) missing.push('author');
    if (!submitForm.skillContent) missing.push('skillContent');

    if (missing.length > 0) {
      setSubmitErrors([`Missing required fields: ${missing.join(', ')}`]);
      return;
    }

    const validationErrors = validateSkillStructure(submitForm.skillContent);
    if (validationErrors.length > 0) {
      setSubmitErrors(validationErrors);
      return;
    }

    setSubmitLoading(true);
    try {
      await fetchApi(API_BASE, {
        method: 'POST',
        body: JSON.stringify({
          name: submitForm.name,
          description: submitForm.description,
          author: submitForm.author,
          version: submitForm.version || '1.0.0',
          tags: submitForm.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          triggers: submitForm.triggers
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          agentType: submitForm.agentType,
          skillContent: submitForm.skillContent,
        }),
      });
      setSubmitSuccess(true);
      setSubmitForm({
        name: '',
        description: '',
        author: '',
        version: '1.0.0',
        tags: '',
        triggers: '',
        agentType: 'any',
        skillContent: '',
      });
      void loadListings();
      setTimeout(() => {
        setShowSubmitDialog(false);
        setSubmitSuccess(false);
      }, 2000);
    } catch (err) {
      setSubmitErrors([err instanceof Error ? err.message : 'Submission failed']);
    } finally {
      setSubmitLoading(false);
    }
  };

  const agentTypes = Array.from(new Set(listings.map((listing) => listing.agentType || 'general'))).sort();
  const filteredListings = listings
    .filter((l) => {
      const query = filter.toLowerCase().trim();
      const matchesQuery = !query || l.name.toLowerCase().includes(query) ||
        (l.tags || []).some((t) => t.toLowerCase().includes(query)) ||
        (l.description || '').toLowerCase().includes(query);
      return matchesQuery && (agentFilter === 'ALL' || (l.agentType || 'general') === agentFilter);
    })
    .sort((a, b) => {
      if (sortMode === 'downloads') return b.downloads - a.downloads;
      if (sortMode === 'rating') return b.rating - a.rating;
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'newest') return b.version.localeCompare(a.version, undefined, { numeric: true });
      return 0;
    });

  const installSelected = async () => {
    if (!selectedListing) return;
    setInstalling(true);
    setInstallMessage(null);
    try {
      await fetchApi(`${API_BASE}/${selectedListing.id}/install`, { method: 'POST' });
      setInstalledIds((current) => new Set(current).add(selectedListing.id));
      setInstallMessage('Skill installed and registered in the local stack.');
      await loadListings();
    } catch (err) {
      setInstallMessage(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const uninstallSelected = async () => {
    if (!selectedListing) return;
    setInstalling(true);
    setInstallMessage(null);
    try {
      await fetchApi(`${API_BASE}/${selectedListing.id}/uninstall`, { method: 'POST' });
      setInstalledIds((current) => {
        const next = new Set(current);
        next.delete(selectedListing.id);
        return next;
      });
      setInstallMessage('Skill deactivated. Its content remains available for rollback.');
    } catch (err) {
      setInstallMessage(err instanceof Error ? err.message : 'Uninstall failed');
    } finally {
      setInstalling(false);
    }
  };

  const prepareMigration = async (id: string) => {
    try {
      const draft = await fetchApi<{ path: string; errors: string[] }>(`${API_BASE}/${id}/migrate`, { method: 'POST' });
      setReviewMessage(`Migration draft created at ${draft.path}`);
    } catch (err) {
      setReviewMessage(err instanceof Error ? err.message : 'Migration failed');
    }
  };

  const prepareAllMigrations = async () => {
    setMigrationLoading(true);
    try {
      const result = await fetchApi<{ total: number; created: number }>(`${API_BASE}/migrations`, { method: 'POST', body: JSON.stringify({ limit: 250 }) });
      setReviewMessage(`Migration queue prepared: ${result.created}/${result.total} drafts created.`);
    } catch (err) {
      setReviewMessage(err instanceof Error ? err.message : 'Bulk migration failed');
    } finally {
      setMigrationLoading(false);
    }
  };

  const moderateListing = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await fetchApi(`${API_BASE}/${id}/moderate`, { method: 'POST', body: JSON.stringify({ status }) });
      await Promise.all([loadCatalogReport(), loadListings()]);
      setReviewMessage(`${id} marked as ${status}.`);
    } catch (err) {
      setReviewMessage(err instanceof Error ? err.message : 'Moderation failed');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{tt('ui.skill_marketplace')}</h2>
        <button
          onClick={() => {
            setShowSubmitDialog(true);
            setSubmitErrors([]);
            setSubmitSuccess(false);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          {tt('ui.mkt_publish_skill')}
        </button>
      </div>

      {/* Search */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-gray-500">
          <SlidersHorizontal className="w-4 h-4" /> {tt('ui.mkt_discover_skills')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_180px] gap-3">
          <input
            type="text"
            placeholder={tt('ui.mkt_search_placeholder')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={tt('ui.mkt_search_aria')}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <select aria-label={tt('ui.mkt_filter_agent_type_aria')} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="ALL">{tt('ui.all_agent_types')}</option>
            {agentTypes.map((agentType) => <option key={agentType} value={agentType}>{agentType}</option>)}
          </select>
          <select aria-label={tt('ui.mkt_sort_aria')} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
            <option value="relevance">{tt('ui.sort_relevance')}</option>
            <option value="newest">{tt('ui.sort_newest')}</option>
            <option value="downloads">{tt('ui.sort_downloads')}</option>
            <option value="rating">{tt('ui.sort_rating')}</option>
            <option value="name">{tt('ui.sort_name')}</option>
          </select>
        </div>
        <p className="mt-3 text-xs text-gray-500">{tt('ui.mkt_showing_of').replace('{shown}', String(filteredListings.length)).replace('{total}', String(listings.length))}</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{tt('ui.catalog_governance')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {catalogReport
                ? tt('ui.mkt_catalog_summary')
                    .replace('{valid}', String(catalogReport.valid))
                    .replace('{invalid}', String(catalogReport.invalid))
                    .replace('{total}', String(catalogReport.total))
                : tt('ui.mkt_validation_loading')}
            </p>
          </div>
          <button
            onClick={() => setShowReview((current) => !current)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {showReview ? tt('ui.mkt_hide_review_queue') : tt('ui.mkt_open_review_queue')}
          </button>
          <button onClick={() => void prepareAllMigrations()} disabled={migrationLoading} className="px-3 py-2 text-sm bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50">
            {migrationLoading ? tt('ui.mkt_preparing_drafts') : tt('ui.mkt_prepare_all_drafts')}
          </button>
        </div>
        {reviewMessage && <p className="mt-3 text-sm text-blue-600 dark:text-blue-300">{reviewMessage}</p>}
        {showReview && catalogReport && (
          <div className="mt-4 max-h-80 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
            {catalogReport.entries.filter((entry) => !entry.validation?.valid).map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{entry.name}</p>
                  <p className="text-xs text-gray-500">{entry.validation?.errors.join(' · ')}</p>
                </div>
                <button
                  onClick={() => void prepareMigration(entry.id)}
                  className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                >
                  {tt('ui.mkt_prepare_draft')}
                </button>
              </div>
            ))}
            {catalogReport.entries.filter((entry) => entry.validation?.valid && entry.status !== 'approved').map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-gray-800">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{entry.name}</p>
                  <p className="text-xs text-green-600">Validation passed · ready for approval</p>
                </div>
                <button
                  onClick={() => void moderateListing(entry.id, 'approved')}
                    className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
                  >
                    {tt('ui.mkt_approve')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={loadListings} className="ml-auto underline text-sm">
            {tt('ui.mkt_retry')}
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Listings Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredListings.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
              {filter
                ? tt('ui.mkt_no_match')
                : tt('ui.mkt_no_skills_yet')}
            </div>
          ) : (
            filteredListings.map((listing) => (
              <div
                key={listing.id}
                className="card cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedListing(listing)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {listing.name}
                  </h3>
                  <span className="text-xs text-gray-500">v{listing.version}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {listing.description}
                </p>

                <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                  <span className="flex items-center gap-1">
                    <Download className="w-4 h-4" />
                    {listing.downloads}
                  </span>
                  <span className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-yellow-500" />
                    {listing.rating.toFixed(1)}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <User className="w-4 h-4" />
                  {listing.author}
                </div>

                {(listing.tags || []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {listing.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs"
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedListing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {selectedListing.name}
                </h3>
                <p className="text-gray-600 dark:text-gray-400">{selectedListing.description}</p>
              </div>
              <button
                onClick={() => setSelectedListing(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-6 text-sm">
                <span className="flex items-center gap-1">
                  <Download className="w-4 h-4" />
                  {tt('ui.mkt_downloads_count').replace('{n}', String(selectedListing.downloads))}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500" />
                  {selectedListing.rating.toFixed(1)} {tt('ui.mkt_reviews_paren').replace('{n}', String(selectedListing.reviews.length))}
                </span>
                {selectedListing.agentType && (
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs">
                    {selectedListing.agentType}
                  </span>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">{tt('ui.reviews')}</h4>
                {selectedListing.reviews.length === 0 ? (
                  <p className="text-gray-500 text-sm">{tt('ui.no_reviews_yet')}</p>
                ) : (
                  <div className="space-y-2">
                    {selectedListing.reviews.map((review) => (
                      <div
                        key={review.id}
                        className="border-b border-gray-200 dark:border-gray-700 pb-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{review.user}</span>
                          <span className="flex items-center text-yellow-500">
                            <Star className="w-4 h-4" />
                            {review.rating}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{review.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {installMessage && (
                <p className="text-sm text-gray-600 dark:text-gray-300">{installMessage}</p>
              )}
              {installedIds.has(selectedListing.id) ? (
                <button
                  onClick={() => void uninstallSelected()}
                  disabled={installing}
                  className="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                >
                  {installing ? tt('ui.mkt_deactivating') : tt('ui.mkt_deactivate_skill')}
                </button>
              ) : (
                <button
                  onClick={() => void installSelected()}
                  disabled={installing}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {installing ? tt('ui.mkt_installing') : tt('ui.mkt_install_skill')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit Skill Dialog */}
      {showSubmitDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {tt('ui.mkt_submit_title')}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                  {tt('ui.mkt_share_hint')}
                </p>
              </div>
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {submitSuccess && (
              <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg mb-4">
                <CheckCircle className="w-5 h-5" />
                <span>
                  {tt('ui.mkt_submitted_success')}
                </span>
              </div>
            )}

            {submitErrors.length > 0 && (
              <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg mb-4">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium">{tt('ui.submission_errors')}</span>
                  <ul className="list-disc list-inside text-sm mt-1">
                    {submitErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_skill_name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="my-awesome-skill"
                    value={submitForm.name}
                    onChange={(e) => setSubmitForm({ ...submitForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {tt('ui.mkt_kebab_hint')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_author')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="your-github-handle"
                    value={submitForm.author}
                    onChange={(e) => setSubmitForm({ ...submitForm, author: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_description')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  placeholder={tt('ui.mkt_description_placeholder')}
                  value={submitForm.description}
                  onChange={(e) => setSubmitForm({ ...submitForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_version')}
                  </label>
                  <input
                    type="text"
                    placeholder="1.0.0"
                    value={submitForm.version}
                    onChange={(e) => setSubmitForm({ ...submitForm, version: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_agent_type')}
                  </label>
                  <select
                    value={submitForm.agentType}
                    onChange={(e) => setSubmitForm({ ...submitForm, agentType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    {AGENT_TYPES.map((at) => (
                      <option key={at} value={at}>
                        {at}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_tags')}
                  </label>
                  <input
                    type="text"
                    placeholder="api, backend, rest"
                    value={submitForm.tags}
                    onChange={(e) => setSubmitForm({ ...submitForm, tags: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {tt('ui.mkt_triggers')}
                </label>
                <input
                  type="text"
                  placeholder="openapi, api spec, rest api"
                  value={submitForm.triggers}
                  onChange={(e) => setSubmitForm({ ...submitForm, triggers: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {tt('ui.mkt_triggers_hint')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {tt('ui.mkt_skillmd_content')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  placeholder={`---\nname: my-skill\ndescription: Does something great\n---\n\n## When to Use\n...\n\n## Examples\n...`}
                  value={submitForm.skillContent}
                  onChange={(e) => setSubmitForm({ ...submitForm, skillContent: e.target.value })}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {tt('ui.mkt_skillmd_hint')}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                {tt('ui.cancel')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitLoading}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    {tt('ui.mkt_submitting')}
                  </>
                ) : (
                  tt('ui.mkt_submit_skill')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Marketplace;
