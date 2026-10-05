// Shapes of the Directus collections as the frontend reads them (see cms/schema/snapshot.yaml).

export type LanguageCode = 'en-US' | 'id-ID';

export interface DirectusFile {
  id: string;
  title: string | null;
  width: number | null;
  height: number | null;
  type: string | null;
  filename_download: string;
}

interface Translated<T> {
  translations: (T & { languages_code: LanguageCode })[];
}

export interface Highlight {
  value: string;
  label: string;
}

export interface Principle {
  title: string;
  description: string;
}

export interface SpokenLanguage {
  name: string;
  level: string;
}

export interface ProfileTranslation {
  headline: string | null;
  short_bio: string | null;
  summary: string | null;
  highlights: Highlight[] | null;
  principles: Principle[] | null;
  spoken_languages: SpokenLanguage[] | null;
}

export interface Profile extends Translated<ProfileTranslation> {
  full_name: string;
  email: string | null;
  linkedin_url: string | null;
  location: string | null;
  photo: DirectusFile | null;
  cv_file: DirectusFile | null;
}

export interface ProjectTranslation {
  summary: string | null;
  body: string | null;
}

export interface Project extends Translated<ProjectTranslation> {
  id: number;
  slug: string;
  title: string;
  type: 'product' | 'project';
  client: string | null;
  year_start: number | null;
  year_end: number | null;
  is_ongoing: boolean;
  featured: boolean;
  platforms: string[] | null;
  roles: string[] | null;
  cover: DirectusFile | null;
  url: string | null;
  sort: number | null;
  experiences?: { experiences_id: Pick<Experience, 'id' | 'company' | 'start_date' | 'end_date' | 'translations'> }[];
}

export interface ExperienceTranslation {
  role: string | null;
  context: string | null;
  responsibilities: string | null;
  achievements: string | null;
}

export interface Experience extends Translated<ExperienceTranslation> {
  id: number;
  company: string;
  company_url: string | null;
  location: string | null;
  employment_type: 'full_time' | 'contract' | 'internship' | 'apprenticeship';
  start_date: string;
  end_date: string | null;
  projects?: { projects_id: Pick<Project, 'slug' | 'title'> }[];
}

export interface PostTranslation {
  title: string;
  excerpt: string | null;
  body: string | null;
}

export interface Post extends Translated<PostTranslation> {
  id: number;
  slug: string;
  published_at: string;
  tags: string[] | null;
  medium_url: string | null;
  original_language: LanguageCode;
  cover: DirectusFile | null;
}

export interface EducationTranslation {
  degree: string | null;
  description: string | null;
}

export interface Education extends Translated<EducationTranslation> {
  id: number;
  institution: string;
  category: 'formal' | 'non_formal';
  grade: string | null;
  start_year: number | null;
  end_year: number | null;
}

export interface Certification {
  id: number;
  name: string;
  issuer: string | null;
  issued_date: string | null;
  credential_url: string | null;
}

export interface SkillTranslation {
  name: string;
  keywords: string[] | null;
}

export interface Skill extends Translated<SkillTranslation> {
  id: number;
}
