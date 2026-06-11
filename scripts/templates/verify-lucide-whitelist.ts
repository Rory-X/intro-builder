/**
 * Verify every lucide name in our SKILL.md whitelist actually exists in
 * lucide-react. Catches typos / removed icons before they end up in
 * Skill output.
 */
import * as Lucide from "lucide-react";

const WHITELIST = [
  // summary
  "User", "Quote", "Info", "MessageSquare", "FileText",
  // experience
  "Briefcase", "Building2", "Building",
  // education
  "GraduationCap", "BookOpen", "School",
  // projects (no Github — brand logos moved out of lucide main pkg)
  "FolderKanban", "Folder", "Layers", "Code2",
  // skills
  "Sparkles", "Star", "Wrench", "Lightbulb", "Zap", "Target",
  // awards
  "Award", "Trophy", "Medal", "Crown",
  // activities
  "Users", "UserCheck", "Heart", "Handshake",
  // research
  "FlaskConical", "Microscope",
  // portfolio
  "Image", "Palette", "LayoutGrid", "Camera",
  // contact (no Linkedin — same brand-logo reason)
  "Mail", "Phone", "MapPin", "Globe",
  // fallback
  "Tag", "Bookmark", "Hash", "ChevronRight",
];

const exported = new Set(Object.keys(Lucide));
const missing = WHITELIST.filter((n) => !exported.has(n));
const present = WHITELIST.filter((n) => exported.has(n));

console.log(`whitelist size: ${WHITELIST.length}`);
console.log(`present: ${present.length}`);
console.log(`missing: ${missing.length}`);
if (missing.length > 0) {
  console.log("MISSING:");
  for (const n of missing) console.log(`  • ${n}`);
}
