import { AuditDetailClient } from "./_client";

interface AuditDetailPageProps {
  params: Promise<{ entryId: string }>;
}

export const metadata = {
  title: "Registro de auditoria — Painel da plataforma",
};

export default async function AuditDetailPage({ params }: AuditDetailPageProps) {
  const { entryId } = await params;
  return <AuditDetailClient entryId={entryId} />;
}
