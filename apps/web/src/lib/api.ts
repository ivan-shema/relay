import type {
  AuthResponse,
  AuthUser,
  GoogleSignInResponse,
  BookingDetail,
  PaymentDetail,
  PaymentMethod,
  Place,
  TripSummary,
  TripFilters,
  TrackingSnapshot,
  TicketSummary,
  Paginated,
} from "@relay/shared";

export type { Paginated, TicketSummary } from "@relay/shared";

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

// Single-flight token refresh: when the access token expires mid-session,
// swap it for a fresh pair using the refresh token. Parallel 401s share one
// refresh call. Returns false when the refresh token is missing/expired too.
let refreshInFlight: Promise<boolean> | null = null;
function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = tokenStore.refresh;
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        tokenStore.set(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// The session is genuinely dead (refresh failed) — clear it and send the user
// to login instead of leaving them staring at "Invalid or expired token"
// errors inside whatever form they happened to be in.
function forceLogout(): never {
  tokenStore.clear();
  if (typeof window !== "undefined") window.location.href = "/auth?mode=login";
  throw new ApiError(401, "Your session expired — please sign in again");
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const doFetch = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.auth && tokenStore.access) {
      headers.Authorization = `Bearer ${tokenStore.access}`;
    }
    return fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let res = await doFetch();
  // Expired access token on an authenticated call → refresh once and retry;
  // if the session can't be revived, log out. Business 401s (login, refresh
  // itself) don't pass auth: true so they surface normally.
  if (res.status === 401 && options.auth) {
    if (await refreshTokens()) res = await doFetch();
    if (res.status === 401) forceLogout();
  }

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
  const doFetch = () => {
    const headers: Record<string, string> = {};
    if (auth && tokenStore.access) headers.Authorization = `Bearer ${tokenStore.access}`;
    return fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });
  };
  let res = await doFetch();
  if (res.status === 401 && auth) {
    if (await refreshTokens()) res = await doFetch();
    if (res.status === 401) forceLogout();
  }
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

  login: (body: { identifier: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body }),

  verifyOtp: (body: { userId: string; code: string }) =>
    request<{ verified: boolean; user: AuthUser }>("/auth/verify-otp", { method: "POST", body }),

  resendOtp: (userId: string) =>
    request<{ sent: boolean }>("/auth/resend-otp", { method: "POST", body: { userId } }),

  forgotPassword: (body: { identifier: string }) =>
    request<{ sent: boolean; userId: string | null }>("/auth/forgot-password", {
      method: "POST",
      body,
    }),

  resetPassword: (body: { userId: string; code: string; password: string }) =>
    request<{ reset: boolean }>("/auth/reset-password", { method: "POST", body }),

  me: () => request<AuthUser>("/auth/me", { auth: true }),

  // Google sign-in — `credential` is the Google Identity Services ID token.
  // Unknown accounts get `needsPhone` back and finish via googleComplete.
  googleSignIn: (credential: string) =>
    request<GoogleSignInResponse>("/auth/google", { method: "POST", body: { credential } }),

  googleComplete: (body: { credential: string; firstName: string; lastName: string; phone: string }) =>
    request<RegisterResp>("/auth/google/complete", { method: "POST", body }),

  // places & trips
  places: (q?: string) => request<Place[]>(`/places${q ? `?q=${encodeURIComponent(q)}` : ""}`),

  // Unfiltered by default — every upcoming departure, paginated.
  trips: (f: TripFilters = {}) => {
    const params = new URLSearchParams();
    if (f.origin) params.set("origin", f.origin);
    if (f.destination) params.set("destination", f.destination);
    if (f.when && f.when !== "all") params.set("when", f.when);
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    if (f.mode) params.set("mode", f.mode);
    if (f.available) params.set("available", "1");
    if (f.page) params.set("page", String(f.page));
    if (f.pageSize) params.set("pageSize", String(f.pageSize));
    const qs = params.toString();
    return request<Paginated<TripSummary>>(`/trips${qs ? `?${qs}` : ""}`);
  },

  trip: (id: string) => request<TripSummary>(`/trips/${id}`),

  // bookings
  createBooking: (body: { tripId: string; seats?: number }) =>
    request<BookingDetail>("/bookings", { method: "POST", body, auth: true }),

  bookings: (page?: number) => request<Paginated<BookingDetail>>(`/bookings${pageQuery(page)}`, { auth: true }),

  booking: (id: string) => request<BookingDetail>(`/bookings/${id}`, { auth: true }),

  // payments — idempotencyKey is stable per attempt so a retried request
  // replays the stored result instead of charging the wallet again
  pay: (body: { bookingId: string; method?: PaymentMethod; idempotencyKey?: string }) =>
    request<PaymentDetail>("/payments", { method: "POST", body, auth: true }),

  // tracking
  tracking: (bookingId: string) =>
    request<TrackingSnapshot>(`/tracking/${bookingId}`, { auth: true }),

  // on-demand moto hailing
  nearbyMotos: () => request<NearbyMoto[]>("/rides/nearby", { auth: true }),
  requestRide: (body: { originLabel: string; destLabel: string; offerFare?: number; targetDriverId?: string; departAt?: string }) =>
    request<RideView>("/rides", { method: "POST", body, auth: true }),
  myRide: () => request<RideView | null>("/rides/mine", { auth: true }),
  acceptRideOffer: (rideId: string, offerId: string) =>
    request<RideView>(`/rides/${rideId}/offers/${offerId}/accept`, { method: "POST", auth: true }),
  payRide: (id: string, idempotencyKey?: string) => request<RideView>(`/rides/${id}/pay`, { method: "POST", body: { method: "WALLET", idempotencyKey }, auth: true }),
  rebroadcastRide: (id: string) => request<RideView>(`/rides/${id}/rebroadcast`, { method: "POST", auth: true }),
  extendRide: (id: string) => request<RideView>(`/rides/${id}/extend`, { method: "POST", auth: true }),
  reportNoPickup: (id: string) => request<RideView>(`/rides/${id}/report-no-pickup`, { method: "POST", auth: true }),
  withdrawNoPickupReport: (id: string) => request<RideView>(`/rides/${id}/withdraw-report`, { method: "POST", auth: true }),
  confirmRideComplete: (id: string) => request<RideView>(`/rides/${id}/confirm-complete`, { method: "POST", auth: true }),
  cancelRide: (id: string) => request<{ cancelled: boolean; refunded: boolean }>(`/rides/${id}/cancel`, { method: "POST", auth: true }),
  driverMotoRequests: () =>
    request<{ current: DriverMotoRequest | null; hailing: { enabled: boolean; reason: string | null } }>("/driver/moto-requests", { auth: true }),
  driverAcknowledgeNoPickup: (id: string) =>
    request<{ acknowledged: boolean }>(`/driver/moto-requests/${id}/acknowledge-no-pickup`, { method: "POST", auth: true }),
  driverContestDispute: (id: string) =>
    request<{ contested: boolean }>(`/driver/moto-requests/${id}/contest-dispute`, { method: "POST", auth: true }),
  adminRideDisputes: () => request<AdminRideDispute[]>("/admin/ride-disputes", { auth: true }),
  adminResolveRideDispute: (id: string, outcome: "REFUND_PASSENGER" | "PAY_OPERATOR") =>
    request<{ resolved: boolean; outcome: string }>(`/admin/ride-disputes/${id}/resolve`, { method: "POST", body: { outcome }, auth: true }),
  driverPickupMotoRide: (id: string) => request<{ pickedUp: boolean }>(`/driver/moto-requests/${id}/pickup`, { method: "POST", auth: true }),
  driverCompleteMotoRide: (id: string) => request<{ requested: boolean }>(`/driver/moto-requests/${id}/complete`, { method: "POST", auth: true }),

  // tickets — one per purchased seat, boarded independently. Staff confirm
  // boarding by the code on the ticket the passenger presents, never by an id
  // already visible to them from a booking list.
  verifyTicket: (code: string) =>
    request<{ seatNumber: string; boarded: boolean }>("/tickets/verify", { method: "POST", body: { code }, auth: true }),

  // ratings — editableUntil marks how long a typo/misclick can still be fixed
  rate: (body: { bookingId: string; score: number; comment?: string }) =>
    request<RatingResult>("/ratings", { method: "POST", body, auth: true }),
  updateRating: (bookingId: string, body: { score: number; comment?: string }) =>
    request<RatingResult>(`/ratings/${bookingId}`, { method: "PATCH", body, auth: true }),

  // planned (Plan ahead watches)
  planned: () => request<PlannedWatch[]>("/planned", { auth: true }),

  createPlanned: (body: { originLabel: string; destLabel: string; whenLabel: string; notify: boolean }) =>
    request<{ id: string }>("/planned", { method: "POST", body, auth: true }),

  deletePlanned: (id: string) => request<unknown>(`/planned/${id}`, { method: "DELETE", auth: true }),

  // ---- driver ----
  driverMe: () => request<DriverMe>("/driver/me", { auth: true }),
  driverSetOnline: (online: boolean) => request<{ online: boolean }>("/driver/online", { method: "POST", body: { online }, auth: true }),
  // assigned departures — the driver runs them; no accepting/declining
  driverSchedule: () => request<DriverScheduleTrip[]>("/driver/schedule", { auth: true }),
  driverStartTrip: (id: string) => request<{ started: boolean }>(`/driver/trips/${id}/start`, { method: "POST", auth: true }),
  driverCompleteTrip: (id: string) => request<{ completed: boolean }>(`/driver/trips/${id}/complete`, { method: "POST", auth: true }),

  // ---- operator ----
  // Onboarding — a signed-in passenger applies to become an operator (multipart:
  // company fields + ID doc + RDB certificate). Stays a passenger until approved.
  applyOperator: (formData: FormData) => requestMultipart<{ id: string; status: string }>("/operator/apply", formData, true),
  // The caller's own application status, or null if they haven't applied.
  operatorApplication: () => request<OperatorApplicationStatus | null>("/operator/application", { auth: true }),
  operatorMe: () => request<{ id: string; companyName: string; modes: string[]; status: string; contactInfo: string }>("/operator/me", { auth: true }),
  operatorOverview: () => request<OperatorOverview>("/operator/overview", { auth: true }),
  operatorVehicles: (page?: number) => request<Paginated<OperatorVehicle>>(`/operator/vehicles${pageQuery(page)}`, { auth: true }),
  operatorRoutes: (page?: number) => request<Paginated<OperatorRoute>>(`/operator/routes${pageQuery(page)}`, { auth: true }),
  operatorRouteLookup: () => request<{ value: string; label: string }[]>("/operator/routes/lookup", { auth: true }),
  operatorSchedule: (page?: number) => request<Paginated<OperatorScheduleRow>>(`/operator/schedule${pageQuery(page)}`, { auth: true }),
  // vehicles + drivers for the departure pickers (with type / assigned vehicle so the form can filter by mode)
  operatorScheduleLookups: () => request<ScheduleLookups>("/operator/schedule/lookups", { auth: true }),
  operatorAssignDeparture: (id: string, body: { vehicleId?: string; driverId?: string }) =>
    request<{ ok: boolean }>(`/operator/schedule/${id}/assign`, { method: "PATCH", body, auth: true }),
  operatorDrivers: (page?: number) => request<Paginated<OperatorDriverRow>>(`/operator/drivers${pageQuery(page)}`, { auth: true }),
  operatorDriver: (id: string) => request<OperatorDriverDetail>(`/operator/drivers/${id}`, { auth: true }),
  operatorSuspend: (id: string) => request<{ suspended: boolean }>(`/operator/drivers/${id}/suspend`, { method: "POST", auth: true }),
  operatorDriverTrips: (id: string) => request<OperatorDriverTrip[]>(`/operator/drivers/${id}/trips`, { auth: true }),
  operatorDriverLookups: (id: string) =>
    request<{ vehicles: { value: string; label: string }[]; trips: { value: string; label: string }[] }>(`/operator/drivers/${id}/lookups`, { auth: true }),
  operatorAssignDriverToVehicle: (vehicleId: string, driverId: string | null) =>
    request<{ ok: boolean }>(`/operator/vehicles/${vehicleId}/assign-driver`, { method: "POST", body: { driverId }, auth: true }),
  operatorAssignVehicle: (id: string, vehicleId: string | null) =>
    request<{ ok: boolean }>(`/operator/drivers/${id}/assign-vehicle`, { method: "POST", body: { vehicleId }, auth: true }),
  operatorAssignTrip: (id: string, tripId: string) =>
    request<{ ok: boolean }>(`/operator/drivers/${id}/assign-trip`, { method: "POST", body: { tripId }, auth: true }),
  operatorRemoveDriver: (id: string) => request<{ removed: boolean }>(`/operator/drivers/${id}/remove`, { method: "POST", auth: true }),
  // ---- driver onboarding by invitation ----
  // typeahead over registered passengers (name / email / phone)
  operatorSearchUsers: (q: string) => request<UserSuggestion[]>(`/operator/users/search?q=${encodeURIComponent(q)}`, { auth: true }),
  operatorInviteDriver: (body: { email: string; note?: string }) =>
    request<{ id: string; status: string; registered: boolean }>("/operator/driver-invites", { method: "POST", body, auth: true }),
  operatorDriverInvites: () => request<DriverInviteRow[]>("/operator/driver-invites", { auth: true }),
  operatorApproveDriverInvite: (id: string) => request<{ approved: boolean }>(`/operator/driver-invites/${id}/approve`, { method: "POST", auth: true }),
  operatorRejectDriverInvite: (id: string, reason: string) =>
    request<{ rejected: boolean }>(`/operator/driver-invites/${id}/reject`, { method: "POST", body: { reason }, auth: true }),
  operatorCancelDriverInvite: (id: string) => request<{ cancelled: boolean }>(`/operator/driver-invites/${id}/cancel`, { method: "POST", auth: true }),
  // the invitee's side
  myDriverInvites: () => request<MyDriverInvite[]>("/me/driver-invites", { auth: true }),
  submitDriverInvite: (id: string, formData: FormData) => requestMultipart<{ submitted: boolean }>(`/me/driver-invites/${id}/submit`, formData, true),
  declineDriverInvite: (id: string) => request<{ declined: boolean }>(`/me/driver-invites/${id}/decline`, { method: "POST", auth: true }),
  // public: pre-fill registration from an invitation email link
  inviteInfo: (token: string) => request<{ email: string; company: string; registered: boolean }>(`/auth/invite/${encodeURIComponent(token)}`),
  // authenticated document download URL (use with downloadAuthed)
  documentUrl: (id: string) => `${BASE}/documents/${id}`,
  operatorBookings: (page?: number) => request<Paginated<OperatorBookingRow>>(`/operator/bookings${pageQuery(page)}`, { auth: true }),
  operatorPayments: (page?: number) => request<OperatorPayments>(`/operator/payments${pageQuery(page)}`, { auth: true }),

  // ---- me (passenger self-service) ----
  meStats: () => request<MeStats>("/me/stats", { auth: true }),
  updateProfile: (body: { firstName: string; lastName: string; email: string; phone: string }) =>
    request<AuthUser>("/me/profile", { method: "PATCH", body, auth: true }),
  // profile picture — the API deletes the previous image from storage itself
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return requestMultipart<AuthUser>("/me/avatar", fd, true);
  },
  removeAvatar: () => request<AuthUser>("/me/avatar", { method: "DELETE", auth: true }),
  changePassword: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    request<{ ok: boolean }>("/me/password", { method: "POST", body, auth: true }),
  notifications: (page?: number) => request<NotificationList>(`/me/notifications${pageQuery(page)}`, { auth: true }),
  markNotificationRead: (id: string) => request<unknown>(`/me/notifications/${id}/read`, { method: "POST", auth: true }),
  markAllNotificationsRead: () => request<unknown>("/me/notifications/read-all", { method: "POST", auth: true }),
  wallet: () => request<WalletData>("/me/wallet", { auth: true }),
  walletTopup: (amount: number, phone?: string) => request<TopupResult>("/me/wallet/topup", { method: "POST", body: { amount, phone }, auth: true }),
  walletTopupStatus: (ref: string) => request<{ status: TransferStatus; balance: number }>(`/me/wallet/topup/${ref}/status`, { auth: true }),
  // SSE channel for real-time settlement pushes (webhook → server → UI).
  // EventSource can't set headers, so the access token rides as a query param.
  streamUrl: () => `${BASE}/me/stream?token=${encodeURIComponent(tokenStore.access ?? "")}`,
  setAutoTopup: (enabled: boolean) => request<{ autoTopupEnabled: boolean }>("/me/wallet/auto-topup", { method: "POST", body: { enabled }, auth: true }),
  insights: () => request<Insights>("/me/insights", { auth: true }),
  savedPlaces: () => request<SavedPlace[]>("/me/places", { auth: true }),
  addSavedPlace: (body: { label: string; area: string; icon?: string }) => request<SavedPlace>("/me/places", { method: "POST", body, auth: true }),
  deleteSavedPlace: (id: string) => request<unknown>(`/me/places/${id}`, { method: "DELETE", auth: true }),


  // ---- operator writes ----
  operatorAddVehicle: (body: { plateNumber: string; type: string; capacity: number; model?: string }) => request<{ id: string }>("/operator/vehicles", { method: "POST", body, auth: true }),
  operatorAddRoute: (body: { origin: string; destination: string; distanceKm?: number }) => request<{ id: string; name: string }>("/operator/routes", { method: "POST", body, auth: true }),
  operatorAddDeparture: (body: { routeId: string; fare: number; departInMinutes?: number; durationMinutes?: number; capacity?: number; mode?: string; vehicleId?: string; driverId?: string }) => request<{ id: string }>("/operator/departures", { method: "POST", body, auth: true }),
  // multipart: KYC fields + ID document + driving licence document
  operatorWithdraw: () => request<{ amount: number; reference: string; status: TransferStatus }>("/operator/payout", { method: "POST", auth: true }),
  operatorPayoutStatus: (reference: string) => request<{ status: TransferStatus; amount: number; reference: string }>(`/operator/payout/${reference}/status`, { auth: true }),

  // ---- admin writes ----
  adminAddUser: (body: { firstName: string; lastName: string; phone: string; email: string; role: string; companyName?: string; modes?: string[] }) =>
    request<{ id: string; credentialsSentTo: string }>("/admin/users", { method: "POST", body, auth: true }),

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
  adminReportCsvUrl: () => `${BASE}/admin/reports/export?type=revenue&period=all`,

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
  adminOperatorDetail: (id: string) => request<AdminOperatorDetail>(`/admin/operators/${id}`, { auth: true }),
  adminSuspendOperator: (id: string) => request<{ status: string }>(`/admin/operators/${id}/suspend`, { method: "POST", auth: true }),
  adminReinstateOperator: (id: string) => request<{ status: string }>(`/admin/operators/${id}/reinstate`, { method: "POST", auth: true }),
  adminApprovals: () => request<AdminApproval[]>("/admin/approvals", { auth: true }),
  adminApprove: (id: string) => request<unknown>(`/admin/operators/${id}/approve`, { method: "POST", auth: true }),
  adminReject: (id: string, reason: string) => request<unknown>(`/admin/operators/${id}/reject`, { method: "POST", body: { reason }, auth: true }),
  adminPayments: (page?: number) => request<AdminPayments>(`/admin/payments${pageQuery(page)}`, { auth: true }),
  // Reports — `q` is the range query from components/reports.tsx (rangeQuery)
  adminReports: (q = "?period=month") => request<AdminReports>(`/admin/reports${q}`, { auth: true }),
  adminReportExportUrl: (type: AdminReportType, q = "?period=all") => `${BASE}/admin/reports/export${q}&type=${type}`,
  // moto dispatch (operators offering MOTO)
  operatorMotoHails: () => request<OperatorMotoHails>("/operator/moto-hails", { auth: true }),
  operatorAcceptMotoHail: (id: string, driverId: string) =>
    request<{ accepted: boolean; driverId: string; status: string }>(`/operator/moto-hails/${id}/accept`, { method: "POST", body: { driverId }, auth: true }),
  operatorQuoteMotoHail: (id: string, driverId: string, amount: number) =>
    request<{ quoted: boolean }>(`/operator/moto-hails/${id}/quote`, { method: "POST", body: { driverId, amount }, auth: true }),
  operatorWithdrawMotoHail: (id: string) => request<{ withdrawn: boolean }>(`/operator/moto-hails/${id}/withdraw`, { method: "POST", auth: true }),
  operatorReassignMotoHail: (id: string, driverId: string) =>
    request<{ reassigned: boolean }>(`/operator/moto-hails/${id}/reassign`, { method: "POST", body: { driverId }, auth: true }),
  operatorReports: (q = "?period=month") => request<OperatorReports>(`/operator/reports${q}`, { auth: true }),
  operatorReportExportUrl: (q = "?period=month") => `${BASE}/operator/reports/export${q}`,
  myReports: (q = "?period=month") => request<PassengerReports>(`/me/reports${q}`, { auth: true }),
  myReportExportUrl: (q = "?period=month") => `${BASE}/me/reports/export${q}`,
  adminResolveComplaint: (id: string) => request<unknown>(`/admin/complaints/${id}/resolve`, { method: "POST", auth: true }),
  adminSettings: () => request<{ motoCommissionPct: number }>("/admin/settings", { auth: true }),
  adminUpdateSettings: (body: { motoCommissionPct: number }) =>
    request<{ motoCommissionPct: number }>("/admin/settings", { method: "PATCH", body, auth: true }),
};

export interface RatingResult {
  id: string;
  bookingId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  editableUntil: string;
}

// ---------- on-demand moto hailing ----------
export interface NearbyMoto {
  driverId: string;
  name: string;
  rating: number;
  plate: string;
  model: string;
  operator: string;
  distanceKm: number;
}
export type RideStatus = "OPEN" | "ACCEPTED" | "CONFIRMED" | "IN_PROGRESS" | "AWAITING_CONFIRM" | "DISPUTED" | "COMPLETED" | "CANCELLED";
export interface RideOfferView {
  id: string;
  amount: number;
  driverName: string;
  rating: number;
  plate: string;
  distanceKm: number;
  operator: string | null;
}
export interface RideView {
  id: string;
  from: string;
  to: string;
  offerFare: number | null;
  agreedFare: number | null;
  departAt: string | null;
  status: RideStatus;
  targeted: boolean;
  prepaid: boolean;
  paidAt: string | null;
  pickupDeadline: string | null;
  pickupOverdue: boolean;
  disputedAt: string | null;
  disputeContested: boolean;
  driver: { name: string; phone: string; rating: number; plate: string; model: string; distanceKm: number; operator: string | null } | null;
  offers: RideOfferView[];
  createdAt: string;
  acceptedAt: string | null;
}
// Operator dispatch board for on-demand moto hails (GET /operator/moto-hails).
export interface OperatorMotoHail {
  id: string;
  from: string;
  to: string;
  passenger: string;
  fare: number | null;
  prepaid: boolean;
  departAt: string | null;
  requestedAt: string;
  requested: { id: string; name: string } | null;
  offers: { driverId: string; driverName: string; amount: number }[];
}
export interface OperatorMotoActiveRide {
  id: string;
  from: string;
  to: string;
  passenger: string;
  fare: number | null;
  status: RideStatus;
  driver: { id: string; name: string; plate: string } | null;
  acceptedAt: string | null;
  pickupDeadline: string | null;
}
export interface OperatorMotoDriver {
  id: string;
  name: string;
  plate: string;
  online: boolean;
  suspended: boolean;
  busy: boolean;
  available: boolean;
}
export interface OperatorMotoHails {
  enabled: boolean;
  open: OperatorMotoHail[];
  active: OperatorMotoActiveRide[];
  drivers: OperatorMotoDriver[];
}
export interface DriverMotoRequest {
  id: string;
  status: RideStatus;
  passenger: string;
  passengerPhone: string;
  from: string;
  to: string;
  offerFare: number | null;
  agreedFare: number | null;
  departAt: string | null;
  prepaid: boolean;
  pickupDeadline: string | null;
  pickupOverdue: boolean;
  myOffer: number | null;
  targeted: boolean;
  distanceKm: number;
  requestedAt: string;
  disputedAt: string | null;
  disputeContested: boolean;
}
export interface AdminRideDispute {
  id: string;
  from: string;
  to: string;
  fare: number | null;
  passenger: string;
  passengerPhone: string;
  driver: string;
  driverPhone: string;
  pickedUpClaimedAt: string | null;
  disputedAt: string | null;
  contestedAt: string | null;
  contested: boolean;
  commissionPct: number | null;
}

export interface PlannedWatch {
  id: string;
  from: string;
  to: string;
  when: string;
  notify: boolean;
  matchedTrip: TripSummary | null;
}

// ---------- me / self-service types ----------
export interface MeStats {
  trips: number;
  co2SavedKg: number;
  memberYears: number;
  rating: number;
  tier: string;
  points: number;
  nextTier: string | null;
  tripsToNextTier: number | null;
  tierProgressPct: number;
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
export type TransferStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface WalletTxn {
  id: string;
  label: string;
  kind: "CREDIT" | "DEBIT";
  amount: number;
  status: TransferStatus;
  date: string;
}

// Top-up via Paypack: PENDING + ref until the rider approves the USSD prompt;
// mock mode settles instantly with the new balance.
export interface TopupResult {
  status: TransferStatus;
  balance?: number;
  ref?: string;
}
export interface WalletData {
  balance: number;
  autoTopupEnabled: boolean;
  transactions: WalletTxn[];
}
export interface SavedPlace {
  id: string;
  label: string;
  area: string;
  icon: string;
}
export interface ModeMeta {
  code: string;
  label: string;
  color: string;
  bg: string;
}
export interface FrequentRoute extends ModeMeta {
  route: string;
  tripCount: number;
}
export interface PendingRating {
  bookingId: string;
  route: string;
  fare: number;
}
export interface SpendByMode extends ModeMeta {
  amount: number;
  pct: number;
}
export interface Insights {
  frequentRoutes: FrequentRoute[];
  pendingRating: PendingRating | null;
  spendThisMonth: { total: number; byMode: SpendByMode[] };
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
  // No earnings here — fares belong to the operator the driver works for.
  stats: { tripsToday: number; passengersToday: number; onlineHours: number; tripsWeek: number };
}
// A departure the operator assigned to this driver, with its confirmed
// passengers. No fares: the driver only boards, starts and finishes.
export interface DriverScheduleTrip {
  id: string;
  from: string;
  to: string;
  mode: string;
  departAt: string;
  arriveAt: string;
  status: string;
  capacity: number;
  seatsLeft: number;
  passengers: { bookingId: string; name: string; seats: number; seatNumbers: string | null; boarded: number; status: string }[];
  boarded: number;
  ticketsTotal: number;
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
  driverId: string | null;
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
export interface ScheduleLookups {
  vehicles: { value: string; label: string; type: string; driverId: string | null }[];
  drivers: { value: string; label: string; vehicleId: string | null; vehicleType: string | null }[];
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
  mode: string;
  vehicleId: string | null;
  driverId: string | null;
}
export interface OperatorDriverRow {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  vehicleId: string | null;
  trips: number;
  rating: number;
  revenue: number; // operator revenue from this driver's trips (not personal pay)
  status: string;
}
// Driver onboarding by invitation.
export interface UserSuggestion {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
}
export interface DriverInviteRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  registered: boolean;
  status: string; // INVITED | SUBMITTED | APPROVED | REJECTED | DECLINED
  note: string | null;
  licenseNumber: string | null;
  nationalId: string | null;
  rejectionReason: string | null;
  invitedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  documents: KycDocument[];
}
export interface MyDriverInvite {
  id: string;
  company: string;
  note: string | null;
  status: string;
  rejectionReason: string | null;
  licenseNumber: string | null;
  nationalId: string | null;
  invitedAt: string;
  submittedAt: string | null;
  documents: KycDocument[];
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
  bookingId: string;
  passenger: string;
  route: string;
  mode: string;
  fare: number;
  status: string;
  ticketsBoarded: number;
  ticketsTotal: number;
}
export interface OperatorPayments {
  transactions: Paginated<{ id: string; booking: string; method: string; amount: number; status: string }>;
  payout: { grossToday: number; fee: number; motoRidesToday: number; motoNetToday: number; net: number; nextPayout: number };
}

export interface AdminOverview {
  kpis: Kpi[];
  approvals: AdminApproval[];
  revenueBars: { m: string; value: number }[];
  complaints: { id: string; who: string; message: string; priority: string }[];
  // Paypack merchant float (real money held); null = not connected
  paypack: { balance: number; mtn: number; airtel: number } | null;
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
  rejectionReason?: string | null;
  reviewedAt?: string | null;
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
// The signed-in passenger's own operator application (GET /operator/application).
export interface OperatorApplicationStatus {
  status: string;
  companyName: string;
  contactInfo: string;
  idNumber: string | null;
  modes: string[];
  documents: KycDocument[];
  rejectionReason: string | null;
  reviewedAt: string | null;
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
export interface AdminOperatorDetail {
  id: string;
  company: string;
  type: string;
  color: string;
  bg: string;
  initial: string;
  status: string;
  date: string;
  submittedAt?: string;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  applicant?: string | null;
  email?: string | null;
  phone?: string | null;
  contactInfo?: string | null;
  idNumber?: string | null;
  modes?: string[];
  vehicles: number;
  drivers: number;
  revenue: number;
  documents?: KycDocument[];
}
export interface AdminPayments {
  transactions: Paginated<{ id: string; user: string; operator: string; method: string; amount: number; status: string }>;
  summary: { total: number; mobileMoney: number; wallet: number; qrCard: number };
}
export type AdminReportType = "revenue" | "bookings" | "passengers" | "drivers";
export interface ReportRangeMeta {
  period: "week" | "month" | "year" | "all" | "custom";
  label: string;
  from: string;
  to: string;
}
export interface AdminReports extends ReportRangeMeta {
  kpis: {
    grossVolume: number; busRevenue: number; motoGross: number; platformTake: number; busFee: number; busFeePct: number; motoCommission: number;
    bookings: number; paidBookings: number; rides: number; avgFare: number; multimodalPct: number; activePassengers: number; cancelledBookings: number;
  };
  tripsThisMonth: number;
  avgFare: number;
  multimodalPct: number;
  revenueBars: { m: string; value: number }[];
  byMode: { mode: string; label: string; bookings: number; revenue: number; pct: number }[];
  byOperator: { name: string; bookings: number; revenue: number; platformFee: number; netToOperator: number }[];
  byMethod: { method: string; count: number; amount: number }[];
  bookingsByStatus: { status: string; count: number }[];
}
export interface OperatorReports extends ReportRangeMeta {
  kpis: {
    revenue: number; platformFee: number; platformFeePct: number; motoRides: number; motoRevenue: number; motoCommission: number; net: number; bookings: number; paidBookings: number; cancelled: number; cancelRate: number;
    tripsRun: number; seatsSold: number; capacity: number; occupancyPct: number; avgFare: number; avgRating: number | null; ratingsCount: number;
  };
  revenueBars: { m: string; value: number }[];
  byRoute: { route: string; trips: number; bookings: number; seats: number; revenue: number; capacity: number; occupancyPct: number }[];
  byDriver: { driver: string; bookings: number; completed: number; revenue: number; rating: number | null }[];
  byMode: { mode: string; label: string; bookings: number; revenue: number; pct: number }[];
  byStatus: { status: string; count: number }[];
}
export interface PassengerReportRow {
  date: string; kind: "BOOKING" | "MOTO" | "WALLET"; route: string; mode: string; seats: number | null; amount: number; status: string; reference: string;
}
export interface PassengerReports extends ReportRangeMeta {
  kpis: { spend: number; bookings: number; paidBookings: number; rides: number; cancelled: number; avgPerTrip: number; moneyIn: number; moneyOut: number; refunds: number };
  spendBars: { m: string; value: number }[];
  byMode: { mode: string; label: string; trips: number; amount: number; pct: number }[];
  topRoutes: { route: string; trips: number; amount: number }[];
  rows: PassengerReportRow[];
  truncated: boolean;
}
