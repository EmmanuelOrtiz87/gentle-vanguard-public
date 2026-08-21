import { useEffect, useState, useCallback } from 'react';
import { Star, Download, Tag, User, Plus, X, AlertCircle, CheckCircle } from 'lucide-react';

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

function validateSkillStructure(content: string): string[] {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    errors.push('SKILL.md content is empty');
    return errors;
  }
  if (!/^---/.test(content)) {
    errors.push('Missing YAML frontmatter (must start with ---)');
  }
  if (!/##\s+Usage|##\s+When to Use/.test(content)) {
    errors.push("Missing '## Usage' or '## When to Use' section");
  }
  if (!/##\s+Examples/.test(content)) {
    errors.push("Missing '## Examples' section");
  }
  if (content.includes('---')) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (match) {
      const fm = match[1];
      if (!/name:\s*\S+/.test(fm)) {
        errors.push("Frontmatter missing 'name' field");
      }
      if (!/description:\s*\S+/.test(fm)) {
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
  const [listings, setListings] = useState<SkillListing[]>([]);
  const [selectedListing, setSelectedListing] = useState<SkillListing | null>(null);
  const [filter, setFilter] = useState('');
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

  const filteredListings = listings.filter(
    (l) =>
      l.name.toLowerCase().includes(filter.toLowerCase()) ||
      (l.tags || []).some((t) => t.toLowerCase().includes(filter.toLowerCase())) ||
      (l.description || '').toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Skill Marketplace</h2>
        <button
          onClick={() => {
            setShowSubmitDialog(true);
            setSubmitErrors([]);
            setSubmitSuccess(false);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Publish Skill
        </button>
      </div>

      {/* Search */}
      <div className="card">
        <input
          type="text"
          placeholder="Search skills..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        />
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={loadListings} className="ml-auto underline text-sm">
            Retry
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
                ? 'No skills match your search.'
                : 'No skills available yet. Be the first to publish one!'}
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
                  {selectedListing.downloads} downloads
                </span>
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500" />
                  {selectedListing.rating.toFixed(1)} ({selectedListing.reviews.length} reviews)
                </span>
                {selectedListing.agentType && (
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs">
                    {selectedListing.agentType}
                  </span>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Reviews</h4>
                {selectedListing.reviews.length === 0 ? (
                  <p className="text-gray-500 text-sm">No reviews yet</p>
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

              <button className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Install Skill
              </button>
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
                  Submit Community Skill
                </h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
                  Share your skill with the Gentle-Vanguard community.
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
                  Skill submitted successfully! It will appear in the marketplace shortly.
                </span>
              </div>
            )}

            {submitErrors.length > 0 && (
              <div className="flex items-start gap-2 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg mb-4">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-medium">Submission errors:</span>
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
                    Skill Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="my-awesome-skill"
                    value={submitForm.name}
                    onChange={(e) => setSubmitForm({ ...submitForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use kebab-case (e.g., my-awesome-skill)
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Author <span className="text-red-500">*</span>
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
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  placeholder="What does this skill do?"
                  value={submitForm.description}
                  onChange={(e) => setSubmitForm({ ...submitForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Version
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
                    Agent Type
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
                    Tags
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
                  Triggers
                </label>
                <input
                  type="text"
                  placeholder="openapi, api spec, rest api"
                  value={submitForm.triggers}
                  onChange={(e) => setSubmitForm({ ...submitForm, triggers: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Comma-separated words that trigger this skill
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  SKILL.md Content <span className="text-red-500">*</span>
                </label>
                <textarea
                  placeholder={`---\nname: my-skill\ndescription: Does something great\n---\n\n## When to Use\n...\n\n## Examples\n...`}
                  value={submitForm.skillContent}
                  onChange={(e) => setSubmitForm({ ...submitForm, skillContent: e.target.value })}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must include YAML frontmatter, a Usage/When to Use section, and an Examples
                  section.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowSubmitDialog(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitLoading}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Submitting...
                  </>
                ) : (
                  'Submit Skill'
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
