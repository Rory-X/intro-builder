import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "node:path";
import type { ResumeContent } from "@/lib/resume-schema";

Font.register({
  family: "NotoSansSC",
  src: path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf"),
});

const s = StyleSheet.create({
  page: { padding: 32, fontFamily: "NotoSansSC", fontSize: 9.5, lineHeight: 1.45, color: "#111", flexDirection: "row" },
  side: { width: 160, paddingRight: 12, borderRight: "1 solid #bbb" },
  main: { flex: 1, paddingLeft: 12 },
  name: { fontSize: 16, fontWeight: 700 },
  role: { color: "#555", marginBottom: 8 },
  sectionTitle: { fontSize: 10.5, fontWeight: 700, marginTop: 8, marginBottom: 3, borderBottom: "1 solid #000", paddingBottom: 1 },
  sideTitle: { fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 2 },
  bullet: { marginLeft: 10, marginTop: 1 },
  row: { flexDirection: "row", justifyContent: "space-between" },
});

export function ModernPdf({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.side}>
          <Text style={s.name}>{b.name}</Text>
          <Text style={s.role}>{b.title}</Text>
          {b.email ? <Text>{b.email}</Text> : null}
          {b.phone ? <Text>{b.phone}</Text> : null}
          {b.location ? <Text>{b.location}</Text> : null}
          {b.website ? <Text>{b.website}</Text> : null}
          {content.skills.length > 0 && (
            <>
              <Text style={s.sideTitle}>技能</Text>
              {content.skills.map((g, i) => (
                <View key={i} style={{ marginBottom: 3 }}>
                  <Text style={{ fontWeight: 700 }}>{g.category}</Text>
                  <Text>{g.items.join(", ")}</Text>
                </View>
              ))}
            </>
          )}
          {content.education.length > 0 && (
            <>
              <Text style={s.sideTitle}>教育</Text>
              {content.education.map((e, i) => (
                <View key={i} style={{ marginBottom: 3 }}>
                  <Text style={{ fontWeight: 700 }}>{e.school}</Text>
                  <Text>{e.degree} {e.major}</Text>
                  <Text style={{ color: "#666" }}>{e.start} – {e.end}</Text>
                </View>
              ))}
            </>
          )}
        </View>
        <View style={s.main}>
          {b.summary ? (
            <>
              <Text style={s.sectionTitle}>自我介绍</Text>
              <Text>{b.summary}</Text>
            </>
          ) : null}
          {content.experience.length > 0 && (
            <>
              <Text style={s.sectionTitle}>工作经历</Text>
              {content.experience.map((e, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <View style={s.row}>
                    <Text style={{ fontWeight: 700 }}>{e.title} @ {e.company}</Text>
                    <Text style={{ color: "#666" }}>{e.start} – {e.end}</Text>
                  </View>
                  {e.bullets.map((x, j) => <Text key={j} style={s.bullet}>• {x}</Text>)}
                </View>
              ))}
            </>
          )}
          {content.projects.length > 0 && (
            <>
              <Text style={s.sectionTitle}>项目</Text>
              {content.projects.map((p, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <Text style={{ fontWeight: 700 }}>{p.name}{p.stack.length > 0 ? `  ${p.stack.join(" · ")}` : ""}</Text>
                  {p.bullets.map((x, j) => <Text key={j} style={s.bullet}>• {x}</Text>)}
                </View>
              ))}
            </>
          )}
        </View>
      </Page>
    </Document>
  );
}
