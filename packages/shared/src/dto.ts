import type {
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  TransportMode,
  TripStatus,
  UserRole,
} from "./enums";

// ---------- Auth ----------
export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
}

export interface LoginInput {
  identifier: string; // email or phone
  password: string;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  walletBalance: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

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

export interface BookingDetail {
  id: string;
  trip: TripSummary;
  status: BookingStatus;
  seats: number;
  fare: number;
  createdAt: string;
  payment?: PaymentDetail;
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

// Standard envelope for paginated list endpoints.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
