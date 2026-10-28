export type Review = {
  id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  name: string;
  role?: string;
  company?: string;
  /** Optional profile photo. Falls back to initials. */
  avatar?: string;
  projectSlug?: string;
  published: boolean;
  /** True while the entry is sample content rather than a real client review. */
  placeholder?: boolean;
};
