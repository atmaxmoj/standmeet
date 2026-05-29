// resume-content.ts —— frontend mirror of backend domain.ResumeContent.
//
// Source of truth: backend/internal/domain/resume.go + resume_project.go.
// Mirror only — when backend shape changes, this changes too. Job context
// (applied-for role + company) is NOT here; that flows from job_snapshot
// at render time via `JobContext` in ResumePage.

export interface ResumePeriod {
  start: string;          // YYYY-MM
  end?: string | null;    // YYYY-MM, null/undef = Present
}

export interface ResumeIdentity {
  name: string;
  email: string;
  phone?: string;
  locationLine: string;
  site?: string;
  links?: ReadonlyArray<{ label: string; url: string }>;
}

export interface ResumeWork {
  title: string;
  company: string;
  location: string;
  period: ResumePeriod;
  bullets: readonly string[];
}

export interface ResumeEducation {
  school: string;
  degree: string;
  period: ResumePeriod;
}

export interface ResumeSkillSet {
  category: string;
  items: readonly string[];
}

export interface ResumeSocial {
  kind: string;
  label?: string;
  handle: string;
}

export interface ResumeCustom {
  label: string;
  value: string;
}

export interface ResumeContent {
  identity: ResumeIdentity;
  summary: string;
  coverLetter?: string;
  works: readonly ResumeWork[];
  educations: readonly ResumeEducation[];
  skills: readonly ResumeSkillSet[];
  social?: readonly ResumeSocial[];
  custom?: readonly ResumeCustom[];
}
