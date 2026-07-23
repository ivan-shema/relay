import type {
  AuthResponse,
  AuthUser,
  BookingDetail,
  PaymentDetail,
  PaymentMethod,
  Place,
  TripSummary,
  TrackingSnapshot,
  Paginated,
} from "@relay/shared";

export type { Paginated } from "@relay/shared";

function pageQuery(page?: number, pageSize?: number): string {
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (pageSize) params.set("pageSize", String(pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ACCESS_KEY = "relay.accessToken";
const REFRESH_KEY = "relay.refreshToken";

export const tokenStore = {
  get access() {
    return typeof window === "undefined" ? null : localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth && tokenStore.access) {
    headers.Authorization = `Bearer ${tokenStore.access}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "Request failed");
  }
  return data as T;
}

// Multipart request (KYC document uploads). Browser sets the multipart
// boundary itself — never set Content-Type manually here.
async function requestMultipart<T>(path: string, formData: FormData, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`;
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string }).error ?? "Request failed");
  }
  return data as T;
}

type RegisterResp = AuthResponse & { requiresVerification?: boolean };

export const api = {
  // auth — public registration is passenger-only (no role field)
  register: (body: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
  }) => request<RegisterResp>("/auth/register", { method: "POST", body }),

  // operator/partner application (multipart: fields + ID doc + RDB certificate)
  applyOperator: (formData: FormData) => requestMultipart<RegisterResp>("/auth/apply-operator", formData),

  login: (body: { identifier: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body }),

  verifyOtp: (body: { userId: string; code: string }) =>
    request<{ verified: boolean; user: AuthUser }>("/auth/verify-otp", { method: "POST", body }),

  forgotPassword: (body: { identifier: string }) =>
    request<{ sent: boolean; userId: string | null }>("/auth/forgot-password", {
      method: "POST",
      body,
    }),

  resetPassword: (body: { userId: string; code: string; password: string }) =>
    request<{ reset: boolean }>("/auth/reset-password", { method: "POST", body }),

  me: () => request<AuthUser>("/auth/me", { auth: true }),

  // places & trips
  places: (q?: string) => request<Place[]>(`/places${q ? `?q=${encodeURIComponent(q)}` : ""}`),

  trips: (origin?: string, destination?: string) => {
    const params = new URLSearchParams();
    if (origin) params.set("origin", origin);
    if (destination) params.set("destination", destination);
    const qs = params.toString();
    return request<TripSummary[]>(`/trips${qs ? `?${qs}` : ""}`);
  },

  trip: (id: string) => request<TripSummary>(`/trips/${id}`),

  // bookings
  createBooking: (body: { tripId: string; seats?: number }) =>
    request<BookingDetail>("/bookings", { method: "POST", body, auth: true }),

  bookings: (page?: number) => request<Paginated<BookingDetail>>(`/bookings${pageQuery(page)}`, { auth: true }),

  booking: (id: string) => request<BookingDetail>(`/bookings/${id}`, { auth: true }),

  // payments
  pay: (body: { bookingId: string; method: PaymentMethod }) =>
    request<PaymentDetail>("/payments", { method: "POST", body, auth: true }),

  // tracking
  tracking: (bookingId: string) =>
    request<TrackingSnapshot>(`/tracking/${bookingId}`, { auth: true }),

  // ratings
  rate: (body: { bookingId: string; score: number; comment?: string }) =>
    request<unknown>("/ratings", { method: "POST", body, auth: true }),

  // planned (Plan ahead watches)
  planned: () =>
    request<{ id: string; from: string; to: string; when: string; notify: boolean }[]>("/planned", {
      auth: true,
    }),

  createPlanned: (body: { originLabel: string; destLabel: string; whenLabel: string; notify: boolean }) =>
    request<{ id: string }>("/planned", { method: "POST", body, auth: true }),

  // ---- driver ----
  driverMe: () => request<DriverMe>("/driver/me", { auth: true }),
  driverSetOnline: (online: boolean) => request<{ online: boolean }>("/driver/online", { method: "POST", body: { online }, auth: true }),
  driverRequests: () => request<DriverRequest[]>("/driver/requests", { auth: true }),
  driverAccept: (id: string) => request<unknown>(`/driver/requests/${id}/accept`, { method: "POST", auth: true }),
  driverDecline: (id: string) => request<unknown>(`/driver/requests/${id}/decline`, { method: "POST", auth: true }),
  driverComplete: (id: string) => request<unknown>(`/driver/requests/${id}/complete`, { method: "POST", auth: true }),
  driverTrips: () => request<DriverTrip[]>("/driver/trips", { auth: true }),

  // ---- operator ----
  operatorMe: () => request<{ id: string; companyName: string; modes: string[]; status: string; contactInfo: string }>("/operator/me", { auth: true }),
  operatorOverview: () => request<OperatorOverview>("/operator/overview", { auth: true }),
  operatorVehicles: (page?: number) => request<Paginated<OperatorVehicle>>(`/operator/vehicles${pageQuery(page)}`, { auth: true }),
  operatorRoutes: () => request<OperatorRoute[]>("/operator/routes", { auth: true }),
  operatorSchedule: (page?: number) => request<Paginated<OperatorScheduleRow>>(`/operator/schedule${pageQuery(page)}`, { auth: true }),
  operatorDrivers: (page?: number) => request<Paginated<OperatorDriverRow>>(`/operator/drivers${pageQuery(page)}`, { auth: true }),
  operatorDriver: (id: string) => request<OperatorDriverDetail>(`/operator/drivers/${id}`, { auth: true }),
  operatorSuspend: (id: string) => request<{ suspended: boolean }>(`/operator/drivers/${id}/suspend`, { method: "POST", auth: true }),
  operatorDriverTrips: (id: string) => request<OperatorDriverTrip[]>(`/operator/drivers/${id}/trips`, { auth: true }),
  operatorDriverLookups: (id: string) =>
    request<{ vehicles: { value: string; label: string }[]; trips: { value: string; label: string }[] }>(`/operator/drivers/${id}/lookups`, { auth: true }),
  operatorAssignVehicle: (id: string, vehicleId: string | null) =>
    request<{ ok: boolean }>(`/operator/drivers/${id}/assign-vehicle`, { method: "POST", body: { vehicleId }, auth: true }),
  operatorAssignTrip: (id: string, tripId: string) =>
    request<{ ok: boolean }>(`/operator/drivers/${id}/assign-trip`, { method: "POST", body: { tripId }, auth: true }),
  operatorRemoveDriver: (id: string) => request<{ removed: boolean }>(`/operator/drivers/${id}/remove`, { method: "POST", auth: true }),
  operatorBookings: (page?: number) => request<Paginated<OperatorBookingRow>>(`/operator/bookings${pageQuery(page)}`, { auth: true }),
  operatorPayments: (page?: number) => request<OperatorPayments>(`/operator/payments${pageQuery(page)}`, { auth: true }),

  // ---- me (passenger self-service) ----
  meStats: () => request<MeStats>("/me/stats", { auth: true }),
  notifications: (page?: number) => request<NotificationList>(`/me/notifications${pageQuery(page)}`, { auth: true }),
  markNotificationRead: (id: string) => request<unknown>(`/me/notifications/${id}/read`, { method: "POST", auth: true }),
  markAllNotificationsRead: () => request<unknown>("/me/notifications/read-all", { method: "POST", auth: true }),
  wallet: () => request<WalletData>("/me/wallet", { auth: true }),
  walletTopup: (amount: number) => request<{ balance: number }>("/me/wallet/topup", { method: "POST", body: { amount }, auth: true }),
  savedPlaces: () => request<SavedPlace[]>("/me/places", { auth: true }),
  addSavedPlace: (body: { label: string; area: string; icon?: string }) => request<SavedPlace>("/me/places", { method: "POST", body, auth: true }),
  deleteSavedPlace: (id: string) => request<unknown>(`/me/places/${id}`, { method: "DELETE", auth: true }),

  // ---- driver actions ----
  driverCashout: () => request<{ amount: number; reference: string }>("/driver/cashout", { method: "POST", auth: true }),

  // ---- operator writes ----
  operatorAddVehicle: (body: { plateNumber: string; type: string; capacity: number; model?: string }) => request<{ id: string }>("/operator/vehicles", { method: "POST", body, auth: true }),
  operatorAddRoute: (body: { originId: string; destinationId: string; distanceKm?: number }) => request<{ id: string; name: string }>("/operator/routes", { method: "POST", body, auth: true }),
  operatorAddDeparture: (body: { routeId: string; fare: number; departInMinutes?: number; durationMinutes?: number; capacity?: number; mode?: string; vehicleId?: string; driverId?: string }) => request<{ id: string }>("/operator/departures", { method: "POST", body, auth: true }),
  // multipart: KYC fields + ID document + driving licence document
  operatorInviteDriver: (formData: FormData) => requestMultipart<{ id: string }>("/operator/drivers/invite", formData, true),
  operatorWithdraw: () => request<{ amount: number; reference: string }>("/operator/payout", { method: "POST", auth: true }),

  // ---- admin writes ----
  adminAddUser: (body: { firstName: string; lastName: string; phone: string; email: string; role: string; companyName?: string; modes?: string[] }) =>
    request<{ id: string }>("/admin/users", { method: "POST", body, auth: true }),

  // authed KYC document — returns an object URL + mime for inline preview.
  // Caller is responsible for revoking the URL when done.
  documentBlob: async (id: string): Promise<{ url: string; type: string }> => {
    const res = await fetch(`${BASE}/documents/${id}`, {
      headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, "Could not load document");
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
  },

  // authed KYC document download (opens in a new tab via blob)
  openDocument: async (id: string) => {
    const res = await fetch(`${BASE}/documents/${id}`, {
      headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, "Could not open document");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  adminReportCsvUrl: () => `${BASE}/admin/reports/export`,

  // ---- admin ----
  adminOverview: () => request<AdminOverview>("/admin/overview", { auth: true }),
  adminUsers: (page?: number, role?: string) => {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (role) params.set("role", role);
    const qs = params.toString();
    return request<Paginated<AdminUser>>(`/admin/users${qs ? `?${qs}` : ""}`, { auth: true });
  },
  adminOperators: (page?: number) => request<Paginated<AdminOperator>>(`/admin/operators${pageQuery(page)}`, { auth: true }),
  adminApprovals: () => request<AdminApproval[]>("/admin/approvals", { auth: true }),
  adminApprove: (id: string) => request<unknown>(`/admin/operators/${id}/approve`, { method: "POST", auth: true }),
  adminReject: (id: string) => request<unknown>(`/admin/operators/${id}/reject`, { method: "POST", auth: true }),
  adminPayments: (page?: number) => request<AdminPayments>(`/admin/payments${pageQuery(page)}`, { auth: true }),
  adminReports: () => request<AdminReports>("/admin/reports", { auth: true }),
  adminResolveComplaint: (id: string) => request<unknown>(`/admin/complaints/${id}/resolve`, { method: "POST", auth: true }),
};

// ---------- me / self-service types ----------
export interface MeStats {
  trips: number;
  co2SavedKg: number;
  memberYears: number;
  rating: number;
}
export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  time: string;
}
export interface NotificationList extends Paginated<NotificationItem> {
  unread: number;
}
export interface WalletTxn {
  id: string;
  label: string;
  kind: "CREDIT" | "DEBIT";
  amount: number;
  date: string;
}
export interface WalletData {
  balance: number;
  transactions: WalletTxn[];
}
export interface SavedPlace {
  id: string;
  label: string;
  area: string;
  icon: string;
}

// ---------- role console response types ----------
export interface DriverMe {
  id: string;
  name: string;
  phone: string;
  online: boolean;
  suspended: boolean;
  rating: number;
  vehicle: { label: string; plate: string; type: string } | null;
  operatorName: string | null;
  stats: { earningsToday: number; tripsToday: number; onlineHours: number; acceptance: number; earningsWeek: number; tripsWeek: number };
}
export interface DriverRequest {
  id: string;
  passenger: string;
  passengerRating: number;
  from: string;
  to: string;
  fare: number;
  distanceKm: number;
  seatNumber: string | null;
}
export interface DriverTrip {
  id: string;
  time: string;
  from: string;
  to: string;
  mode: string;
  fare: number;
  status: string;
}

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  delta: string;
}
export interface OperatorOverview {
  kpis: Kpi[];
  liveBookings: { passenger: string; route: string; time: string; fare: number; status: string }[];
  routePerformance: { name: string; trips: string; util: number }[];
  fleetUtilization: number;
}
export interface OperatorVehicle {
  id: string;
  plate: string;
  type: string;
  model: string;
  capacity: number;
  driver: string;
  util: string;
  status: string;
}
export interface OperatorRoute {
  id: string;
  name: string;
  from: string;
  to: string;
  stops: string;
  buses: string;
  freq: string;
  util: number;
  fare: number;
}
export interface OperatorScheduleRow {
  id: string;
  time: string;
  route: string;
  vehicle: string;
  driver: string;
  booked: number;
  capacity: number;
  status: string;
}
export interface OperatorDriverRow {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  trips: number;
  rating: number;
  revenue: number; // operator revenue from this driver's trips (not personal pay)
  status: string;
}
export interface KycDocument {
  id: string;
  kind: string; // NATIONAL_ID | PASSPORT | DRIVING_LICENSE | BUSINESS_CERTIFICATE
  fileName: string;
  mimeType?: string;
}
export interface OperatorDriverDetail extends OperatorDriverRow {
  vehicleId: string | null;
  nationalId: string | null;
  licenseNumber: string;
  joined: string;
  suspended: boolean;
  documents: KycDocument[];
}
export interface OperatorDriverTrip {
  id: string;
  route: string;
  time: string;
  fare: number;
  status: string;
}
export interface OperatorBookingRow {
  id: string;
  passenger: string;
  route: string;
  mode: string;
  fare: number;
  status: string;
}
export interface OperatorPayments {
  transactions: Paginated<{ id: string; booking: string; method: string; amount: number; status: string }>;
  payout: { grossToday: number; fee: number; net: number; nextPayout: number };
}

export interface AdminOverview {
  kpis: Kpi[];
  approvals: AdminApproval[];
  revenueBars: { m: string; value: number }[];
  complaints: { id: string; who: string; message: string; priority: string }[];
}
export interface AdminApproval {
  id: string;
  company: string;
  type: string;
  color: string;
  bg: string;
  initial: string;
  vehicles: string;
  date: string;
  submittedAt?: string;
  applicant?: string | null;
  email?: string | null;
  phone?: string | null;
  contactInfo?: string | null;
  idNumber?: string | null;
  modes?: string[];
  documents?: KycDocument[];
}
export interface AdminUser {
  id: string;
  name: string;
  role: string;
  phone: string;
  joined: string;
  status: string;
}
export interface AdminOperator {
  id: string;
  company: string;
  type: string;
  color: string;
  bg: string;
  vehicles: number;
  drivers: number;
  revenue: number;
  status: string;
}
export interface AdminPayments {
  transactions: Paginated<{ id: string; user: string; operator: string; method: string; amount: number; status: string }>;
  summary: { total: number; mobileMoney: number; wallet: number; qrCard: number };
}
export interface AdminReports {
  tripsThisMonth: number;
  avgFare: number;
  multimodalPct: number;
  revenueBars: { m: string; value: number }[];
}
