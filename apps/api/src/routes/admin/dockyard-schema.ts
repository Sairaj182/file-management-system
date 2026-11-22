import { z } from "zod";

export const createDockyardSchema = z.object({
  notes: z.string().trim().min(1).max(5000),
});
