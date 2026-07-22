import type { Request } from "express";

export interface PageParams {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

// Parse ?page & ?pageSize from the query with sane bounds.
export function parsePage(req: Request, defaultSize = 10, maxSize = 100): PageParams {
  const rawPage = parseInt(String(req.query.page ?? "1"), 10);
  const rawSize = parseInt(String(req.query.pageSize ?? defaultSize), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize) ? Math.min(maxSize, Math.max(1, rawSize)) : defaultSize;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paged<T>(items: T[], total: number, p: PageParams): Paginated<T> {
  return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}
