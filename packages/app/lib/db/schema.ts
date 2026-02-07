import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  json,
} from "drizzle-orm/pg-core";

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  queryId: text("query_id").notNull(),
  amount: integer("amount").notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
});

export const settlements = pgTable("settlements", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id"),
  arcTransactionHash: text("arc_transaction_hash"),
  amount: integer("amount").notNull(),
  queryIds: json("query_ids").$type<string[]>().notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  chains: json("chains").$type<string[]>().notNull(),
});
