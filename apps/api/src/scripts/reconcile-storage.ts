import { prisma } from "@repo/database";
import { reconcileFiles } from "../services/files";

try {
  const result = await reconcileFiles();
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
