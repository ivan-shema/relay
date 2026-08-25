import type {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  TransportMode,
  TripStatus,
  UserRole,
} from "./enums";

// ---------- Auth ----------
// Public registration is passenger-only — no role field.
export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface LoginInput {
  identifier: string; // email or phone
  password: string;
}

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: UserRole;
  walletBalance: number;
  avatarUrl: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// POST /auth/google — either a full session (account exists / was linked by
// email) or a request to finish signup with a phone number.
export interface GoogleProfile {
  firstName: string;
  lastName: string;
  email: string;
}
export type GoogleSignInResponse = AuthResponse | { needsPhone: true; profile: GoogleProfile };

export interface VerifyOtpInput {
  userId: string;
  code: string;
}

// ---------- Places / search ----------
export interface Place {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
}

export interface SearchTripsQuery {
  originId?: string;
  destinationId?: string;
  origin?: string;
  destination?: string;
}

// ---------- Trips ----------
export interface TripLeg {
  mode: TransportMode;
  code: string; // B / M / R
  color: string;
  label: string;
}

export interface TripSummary {
  id: string;
  routeName: string; // "Kabeza → Central Market"
  origin: string;
  destination: string;
  legs: TripLeg[];
  operatorName: string;
  departAt: string; // ISO
  arriveAt: string; // ISO
  departsInLabel: string; // "in 4 min"
  durationLabel: string; // "32 min"
  seatsLeft: number;
  capacity: number;
  fare: number; // in RWF (whole units)
  surge: boolean;
  status: TripStatus;
  tag?: string; // "Fastest" | "Cheapest" | "Direct"
}

// ---------- Booking ----------
export interface CreateBookingInput {
  tripId: string;
  seats?: number;
}

export interface TicketSummary {
  id: string;
  code: string;
  seatNumber: string;
  boarded: boolean;
}

export interface BookingDetail {
  id: string;
  trip: TripSummary;
  status: BookingStatus;
  seats: number;
  fare: number;
  createdAt: string;
  payment?: PaymentDetail;
  tickets: TicketSummary[];
}

// ---------- Payment ----------
export interface CreatePaymentInput {
  bookingId: string;
  method: PaymentMethod;
}

export interface PaymentDetail {
  id: string;
  bookingId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
}

// ---------- Tracking ----------
export interface TrackingSnapshot {
  tripId: string;
  status: TripStatus;
  vehiclePosition: { lat: number; lng: number; heading: number };
  etaMinutes: number;
  progressPct: number; // 0..100 along the route
  driver: { name: string; vehicle: string; plate: string; phone: string } | null;
  seatNumber?: string;
  anyBoarded?: boolean;
}

// ---------- Ratings ----------
export interface CreateRatingInput {
  bookingId: string;
  score: number; // 1..5
  comment?: string;
}

// ---------- Generic ----------
export interface ApiError {
  error: string;
  details?: unknown;
}

// ---------- Trip search ----------
export type TripWhen = "all" | "live" | "today" | "tomorrow";

// Query for GET /trips. Everything is optional — no filters means every
// upcoming departure.
export interface TripFilters {
  origin?: string;
  destination?: string;
  when?: TripWhen; // "live" = boarding/running, or departing within the hour
  from?: string; // ISO lower bound on departAt (client-computed day window)
  to?: string; // ISO upper bound on departAt
  mode?: TransportMode; // trips with at least one leg in this mode
  available?: boolean; // only trips with seats left
  page?: number;
  pageSize?: number;
}

// Standard envelope for paginated list endpoints.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
