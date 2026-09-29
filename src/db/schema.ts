import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(), // Stocke l'objet Room complet
  updatedAt: timestamp("updated_at").defaultNow(),
});