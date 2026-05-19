import { Globe, Mail, MapPin, Phone } from "lucide-react";
import type { ResumeContent } from "@/lib/resume-schema";

export type ContactItem = {
  icon: React.FC<{ className?: string }>;
  text: string;
};

export function buildContactItems(basics: ResumeContent["basics"]): ContactItem[] {
  return [
    basics.email && { icon: Mail, text: basics.email },
    basics.phone && { icon: Phone, text: basics.phone },
    basics.location && { icon: MapPin, text: basics.location },
    basics.website && { icon: Globe, text: basics.website },
  ].filter(Boolean) as ContactItem[];
}
