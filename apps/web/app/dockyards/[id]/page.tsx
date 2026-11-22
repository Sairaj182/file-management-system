import { DockyardDetail } from "../../../components/dockyard-detail";

export default async function DockyardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const publicApi =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  const limits = {
    maxSize: Number(process.env.FILE_MAX_SIZE_BYTES ?? 10 * 1024 * 1024),
    maxCount: Number(process.env.FILE_MAX_COUNT ?? 5),
    maxTtl: Number(process.env.FILE_SIGNED_URL_MAX_TTL_SECONDS ?? 300),
  };
  return (
    <DockyardDetail key={id} id={id} publicApi={publicApi} limits={limits} />
  );
}
