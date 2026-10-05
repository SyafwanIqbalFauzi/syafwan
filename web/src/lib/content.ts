// Content queries. The token can only see published rows, but every query also
// filters on status so the intent is explicit and survives permission changes.
import { directus, query } from './directus';
import type { Certification, Education, Experience, Post, Profile, Project, Skill } from './schema';

const FILE = 'id,title,width,height,type,filename_download';
const published = JSON.stringify({ status: { _eq: 'published' } });

export const getProfile = () =>
  directus<Profile>(`/items/profile${query({ fields: `*,translations.*,photo.${FILE.replaceAll(',', ',photo.')},cv_file.id,cv_file.filename_download` })}`);

const PROJECT_FIELDS = `id,slug,title,type,client,year_start,year_end,is_ongoing,featured,platforms,roles,url,sort,translations.languages_code,translations.summary,cover.${FILE.replaceAll(',', ',cover.')}`;

export function getProjects(options: { featured?: boolean; type?: 'product' | 'project'; limit?: number } = {}) {
  const filter: Record<string, unknown> = { status: { _eq: 'published' } };
  if (options.featured) filter.featured = { _eq: true };
  if (options.type) filter.type = { _eq: options.type };
  return directus<Project[]>(
    `/items/projects${query({ fields: PROJECT_FIELDS, filter: JSON.stringify(filter), sort: 'sort,-year_start', limit: options.limit ?? -1 })}`,
  );
}

export async function getProject(slug: string) {
  const rows = await directus<Project[]>(
    `/items/projects${query({
      fields: `${PROJECT_FIELDS},translations.body,experiences.experiences_id.id,experiences.experiences_id.company,experiences.experiences_id.start_date,experiences.experiences_id.end_date,experiences.experiences_id.translations.languages_code,experiences.experiences_id.translations.role`,
      filter: JSON.stringify({ status: { _eq: 'published' }, slug: { _eq: slug } }),
      limit: 1,
    })}`,
  );
  return rows[0] ?? null;
}

export const getExperiences = (limit = -1) =>
  directus<Experience[]>(
    `/items/experiences${query({
      fields: '*,translations.*,projects.projects_id.slug,projects.projects_id.title',
      filter: published,
      sort: '-start_date',
      limit,
    })}`,
  );

// Tag filtering happens in the page: `tags` is a JSON column, which Directus can't filter reliably.
export function getPosts(options: { limit?: number } = {}) {
  const filter = { status: { _eq: 'published' } };
  return directus<Post[]>(
    `/items/posts${query({
      fields: 'id,slug,published_at,tags,medium_url,original_language,translations.languages_code,translations.title,translations.excerpt',
      filter: JSON.stringify(filter),
      sort: '-published_at',
      limit: options.limit ?? -1,
    })}`,
  );
}

export async function getPost(slug: string) {
  const rows = await directus<Post[]>(
    `/items/posts${query({
      fields: `*,translations.*,cover.${FILE.replaceAll(',', ',cover.')}`,
      filter: JSON.stringify({ status: { _eq: 'published' }, slug: { _eq: slug } }),
      limit: 1,
    })}`,
  );
  return rows[0] ?? null;
}

export const getEducation = () =>
  directus<Education[]>(`/items/education${query({ fields: '*,translations.*', filter: published, sort: 'sort' })}`);

export const getCertifications = () =>
  directus<Certification[]>(`/items/certifications${query({ fields: '*', filter: published, sort: 'sort' })}`);

export const getSkills = () =>
  directus<Skill[]>(`/items/skills${query({ fields: 'id,translations.*', filter: published, sort: 'sort' })}`);
