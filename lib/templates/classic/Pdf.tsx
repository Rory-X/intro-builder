import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "node:path";
import type { ResumeContent } from "@/lib/resume-schema";

Font.register({
  family: "NotoSansSC",
  src: path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf"),
});

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "NotoSansSC", fontSize: 10, lineHeight: 1.45, color: "#111" },
  h1: { fontSize: 20, textAlign: "center", marginBottom: 2 },
  role: { textAlign: "center", fontSize: 11, marginBottom: 2 },
  meta: { textAlign: "center", fontSize: 9, color: "#555", marginBottom: 10 },
  section: { marginTop: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottom: "1 solid #000", paddingBottom: 2, marginBottom: 4, textTransform: "uppercase" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontWeight: 700 },
  bullet: { marginLeft: 10, marginTop: 1 },
});

export function ClassicPdf({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{b.name}</Text>
        {b.title ? <Text style={styles.role}>{b.title}</Text> : null}
        <Text style={styles.meta}>{[b.email, b.phone, b.location, b.website].filter(Boolean).join("  ·  ")}</Text>

        {b.summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>自我介绍</Text>
            <Text>{b.summary}</Text>
          </View>
        ) : null}

        {content.experience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>工作经历</Text>
            {content.experience.map((e, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <View style={styles.row}>
                  <Text style={styles.bold}>{e.company} — {e.title}</Text>
                  <Text>{e.start} – {e.end}</Text>
                </View>
                {e.bullets.map((x, j) => <Text key={j} style={styles.bullet}>• {x}</Text>)}
              </View>
            ))}
          </View>
        )}

        {content.education.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>教育背景</Text>
            {content.education.map((e, i) => (
              <View key={i} style={styles.row}>
                <Text><Text style={styles.bold}>{e.school}</Text> {e.degree} {e.major}{e.gpa ? ` · GPA ${e.gpa}` : ""}</Text>
                <Text>{e.start} – {e.end}</Text>
              </View>
            ))}
          </View>
        )}

        {content.projects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>项目经历</Text>
            {content.projects.map((p, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={styles.bold}>{p.name}{p.stack.length > 0 ? `  (${p.stack.join(", ")})` : ""}</Text>
                {p.bullets.map((x, j) => <Text key={j} style={styles.bullet}>• {x}</Text>)}
              </View>
            ))}
          </View>
        )}

        {content.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>技能</Text>
            {content.skills.map((s, i) => (
              <Text key={i}><Text style={styles.bold}>{s.category}: </Text>{s.items.join(", ")}</Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
