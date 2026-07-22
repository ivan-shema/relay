import { PrismaClient, type TransportMode } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function inMinutes(min: number) {
  return new Date(Date.now() + min * 60_000);
}
function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000);
}
function makeRef(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function main() {
  console.log("Seeding Relay database…");

  // wipe (dev only) in FK-safe order
  await prisma.payout.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.savedPlace.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.route.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.plannedTrip.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.otp.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.operator.deleteMany();
  await prisma.place.deleteMany();
  await prisma.user.deleteMany();

  const pw = await bcrypt.hash("password123", 10);

  // ---------- Users ----------
  const amara = await prisma.user.create({
    data: { fullName: "Amara N.", email: "amara@relay.app", phone: "+250781104821", passwordHash: pw, role: "PASSENGER", phoneVerified: true, walletBalance: 12400 },
  });
  const passengers = [amara];
  for (const [i, name] of ["Bea K.", "Chris M.", "Diane U.", "Eric T.", "Faith R."].entries()) {
    passengers.push(
      await prisma.user.create({
        data: { fullName: name, email: `passenger${i + 2}@relay.app`, phone: `+2507820000${10 + i}`, passwordHash: pw, role: "PASSENGER", phoneVerified: true, walletBalance: 4000 + i * 1500 },
      })
    );
  }

  const driverUser = await prisma.user.create({
    data: { fullName: "Jean P.", email: "jean@relay.app", phone: "+250788000001", passwordHash: pw, role: "DRIVER", phoneVerified: true },
  });

  const operatorUser = await prisma.user.create({
    data: { fullName: "Kigali Bus Admin", email: "ops@kigalibus.app", phone: "+250788000002", passwordHash: pw, role: "OPERATOR", phoneVerified: true },
  });

  await prisma.user.create({
    data: { fullName: "Relay Admin", email: "admin@relay.app", phone: "+250788000003", passwordHash: pw, role: "ADMIN", phoneVerified: true },
  });

  // ---------- Operators ----------
  const kigaliBus = await prisma.operator.create({
    data: { companyName: "Kigali Bus Co.", contactInfo: "+250 78 •• 0042", modes: ["BUS", "MOTO"], status: "VERIFIED", ownerUserId: operatorUser.id },
  });
  const volcano = await prisma.operator.create({
    data: { companyName: "Volcano Shuttle", contactInfo: "+250 78 •• 1180", modes: ["BUS"], status: "VERIFIED" },
  });
  const twiga = await prisma.operator.create({
    data: { companyName: "Twiga Moto", contactInfo: "+250 78 •• 3321", modes: ["MOTO"], status: "PENDING" },
  });
  const rideLink = await prisma.operator.create({
    data: { companyName: "RideLink Pool", contactInfo: "+250 78 •• 7788", modes: ["RIDE"], status: "PENDING" },
  });

  // ---------- Drivers + vehicles ----------
  // primary demo driver
  const jean = await prisma.driver.create({
    data: { userId: driverUser.id, operatorId: kigaliBus.id, licenseNumber: "RW-DRV-22841", ratingAvg: 4.9, online: true },
  });
  const jeanVehicle = await prisma.vehicle.create({
    data: { operatorId: kigaliBus.id, driverId: jean.id, type: "BUS", plateNumber: "RAD 412 K", capacity: 33, label: "Bus 12", model: "Coaster HD", status: "ACTIVE" },
  });

  // extra drivers for the operator console
  const extraDrivers: { driverId: string; vehicleId: string; name: string }[] = [];
  const driverSpec: { name: string; plate: string; type: TransportMode; cap: number; model: string; rating: number; online: boolean }[] = [
    { name: "David K.", plate: "RAD 482 C", type: "MOTO", cap: 1, model: "Boxer 150", rating: 4.9, online: true },
    { name: "Grace I.", plate: "RAC 740 A", type: "BUS", cap: 30, model: "Coaster", rating: 4.7, online: true },
    { name: "Henri B.", plate: "RAD 663 B", type: "MOTO", cap: 1, model: "TVS", rating: 4.6, online: false },
    { name: "Ivan S.", plate: "RAB 220 D", type: "BUS", cap: 28, model: "Rosa", rating: 4.8, online: true },
  ];
  for (const [i, d] of driverSpec.entries()) {
    const u = await prisma.user.create({
      data: { fullName: d.name, email: `driver${i + 2}@relay.app`, phone: `+2507880010${10 + i}`, passwordHash: pw, role: "DRIVER", phoneVerified: true },
    });
    const dr = await prisma.driver.create({
      data: { userId: u.id, operatorId: kigaliBus.id, licenseNumber: `RW-DRV-${1000 + i}`, ratingAvg: d.rating, online: d.online },
    });
    const v = await prisma.vehicle.create({
      data: { operatorId: kigaliBus.id, driverId: dr.id, type: d.type, plateNumber: d.plate, capacity: d.cap, label: `${d.type} ${d.plate.slice(-3)}`, model: d.model, status: d.online ? "ACTIVE" : "IDLE" },
    });
    extraDrivers.push({ driverId: dr.id, vehicleId: v.id, name: d.name });
  }
  // one maintenance vehicle with no driver
  await prisma.vehicle.create({
    data: { operatorId: kigaliBus.id, type: "BUS", plateNumber: "RAE 090 M", capacity: 33, label: "Bus 20", model: "Coaster", status: "MAINTENANCE" },
  });

  // ---------- Places ----------
  const placeData = [
    { name: "Kabeza", area: "Sector 4", lat: -1.9536, lng: 30.1284, isPopular: true },
    { name: "Central Market", area: "Nyarugenge", lat: -1.9486, lng: 30.0588, isPopular: true },
    { name: "Innovation Park", area: "Kacyiru", lat: -1.9412, lng: 30.0934, isPopular: true },
    { name: "Remera Hub", area: "Gasabo", lat: -1.9578, lng: 30.1127, isPopular: true },
    { name: "Nyabugogo Terminal", area: "Nyarugenge", lat: -1.9395, lng: 30.0444, isPopular: true },
    { name: "Kimironko", area: "Gasabo", lat: -1.9447, lng: 30.1255, isPopular: false },
    { name: "City Centre", area: "Nyarugenge", lat: -1.9441, lng: 30.0619, isPopular: true },
  ];
  const places: Record<string, { id: string }> = {};
  for (const p of placeData) places[p.name] = await prisma.place.create({ data: p });

  const poly = (pts: [number, number][]) => pts;

  // ---------- Routes ----------
  const routeKabeza = await prisma.route.create({
    data: { name: "Kabeza → Central Market", originId: places["Kabeza"].id, destinationId: places["Central Market"].id, distanceKm: 7.4, polyline: poly([[30.1284, -1.9536], [30.1127, -1.9578], [30.0934, -1.9412], [30.0588, -1.9486]]) },
  });
  const routeRemera = await prisma.route.create({
    data: { name: "Remera → City Centre", originId: places["Remera Hub"].id, destinationId: places["City Centre"].id, distanceKm: 5.2, polyline: poly([[30.1127, -1.9578], [30.0934, -1.9412], [30.0619, -1.9441]]) },
  });
  const routeNyabugogo = await prisma.route.create({
    data: { name: "Nyabugogo → Kimironko", originId: places["Nyabugogo Terminal"].id, destinationId: places["Kimironko"].id, distanceKm: 9.1, polyline: poly([[30.0444, -1.9395], [30.0619, -1.9441], [30.0934, -1.9412], [30.1255, -1.9447]]) },
  });

  // ---------- Live trips on Kabeza (assigned to Jean) ----------
  const busMotoLegs = [{ mode: "BUS" }, { mode: "MOTO" }];
  const rideLegs = [{ mode: "RIDE" }];
  const busLegs = [{ mode: "BUS" }];
  const liveTrips = [
    { legs: busMotoLegs, departMin: 4, durMin: 32, fare: 1200, surge: false, cap: 33, seats: 11, status: "BOARDING" as const, tag: "Fastest" },
    { legs: rideLegs, departMin: 7, durMin: 26, fare: 3500, surge: true, cap: 4, seats: 2, status: "RUNNING" as const, tag: "Direct" },
    { legs: busLegs, departMin: 18, durMin: 38, fare: 700, surge: false, cap: 33, seats: 20, status: "SCHEDULED" as const, tag: "Cheapest" },
    { legs: busMotoLegs, departMin: 55, durMin: 30, fare: 1300, surge: false, cap: 33, seats: 6, status: "SCHEDULED" as const },
    { legs: rideLegs, departMin: 95, durMin: 24, fare: 3000, surge: false, cap: 4, seats: 3, status: "SCHEDULED" as const },
    { legs: busLegs, departMin: 150, durMin: 40, fare: 700, surge: false, cap: 33, seats: 28, status: "SCHEDULED" as const },
    { legs: busMotoLegs, departMin: 210, durMin: 34, fare: 1350, surge: false, cap: 33, seats: 15, status: "SCHEDULED" as const },
  ];
  const jeanTrips = [];
  for (const t of liveTrips) {
    jeanTrips.push(
      await prisma.trip.create({
        data: {
          routeId: routeKabeza.id, operatorId: kigaliBus.id, vehicleId: jeanVehicle.id, driverId: jean.id,
          legs: t.legs, departAt: inMinutes(t.departMin), arriveAt: inMinutes(t.departMin + t.durMin),
          fare: t.fare, surge: t.surge, capacity: t.cap, seatsLeft: t.seats, status: t.status, tag: t.tag,
        },
      })
    );
  }

  // A few live trips on other routes / drivers for the operator schedule + admin
  for (const [i, ed] of extraDrivers.entries()) {
    const route = [routeRemera, routeNyabugogo][i % 2];
    await prisma.trip.create({
      data: {
        routeId: route.id, operatorId: kigaliBus.id, vehicleId: ed.vehicleId, driverId: ed.driverId,
        legs: i % 2 === 0 ? busLegs : busMotoLegs, departAt: inMinutes(12 + i * 20), arriveAt: inMinutes(12 + i * 20 + 30),
        fare: 800 + i * 300, surge: false, capacity: 30, seatsLeft: 8 + i, status: i === 0 ? "BOARDING" : "SCHEDULED", tag: i === 0 ? "Fastest" : undefined,
      },
    });
  }

  // ---------- Ride requests: CONFIRMED bookings on Jean's live trips ----------
  // (these appear in the Driver console as incoming requests to accept/decline)
  const reqTrip = jeanTrips[0];
  for (const p of [passengers[1], passengers[2]]) {
    const b = await prisma.booking.create({
      data: { reference: makeRef("RLY"), passengerId: p.id, tripId: reqTrip.id, seats: 1, fare: reqTrip.fare, status: "CONFIRMED", seatNumber: "12A" },
    });
    await prisma.payment.create({
      data: { bookingId: b.id, amount: reqTrip.fare, method: "MOBILE_MONEY", status: "PAID", reference: makeRef("PAY") },
    });
    await prisma.trip.update({ where: { id: reqTrip.id }, data: { seatsLeft: { decrement: 1 } } });
  }

  // ---------- Historical completed bookings (revenue for operator/admin) ----------
  const methods = ["MOBILE_MONEY", "WALLET", "QR"] as const;
  let hist = 0;
  for (let d = 0; d < 24; d++) {
    const trip = jeanTrips[d % jeanTrips.length];
    const passenger = passengers[d % passengers.length];
    const fare = Number(trip.fare);
    const when = hoursAgo(1 + d * 3);
    const b = await prisma.booking.create({
      data: { reference: makeRef("RLY"), passengerId: passenger.id, tripId: trip.id, seats: 1, fare, status: "COMPLETED", seatNumber: "10B", createdAt: when, updatedAt: when },
    });
    await prisma.payment.create({
      data: { bookingId: b.id, amount: fare, method: methods[d % methods.length], status: "PAID", reference: makeRef("PAY"), createdAt: when },
    });
    hist++;
  }

  // ---------- Ratings ----------
  const rated = await prisma.booking.findMany({ where: { status: "COMPLETED" }, take: 6 });
  for (const [i, b] of rated.entries()) {
    await prisma.rating.create({
      data: { bookingId: b.id, passengerId: b.passengerId, score: 4 + (i % 2), comment: i % 2 ? "Smooth ride" : "On time" },
    });
  }

  // ---------- Complaints ----------
  await prisma.complaint.createMany({
    data: [
      { raisedById: passengers[1].id, who: "Passenger · Bea K.", message: "Driver took a longer route than shown in the app.", priority: "HIGH", status: "OPEN" },
      { raisedById: passengers[2].id, who: "Passenger · Chris M.", message: "Charged surge but the trip wasn't at peak time.", priority: "MEDIUM", status: "OPEN" },
      { raisedById: passengers[3].id, who: "Passenger · Diane U.", message: "Bus was full despite showing seats available.", priority: "LOW", status: "OPEN" },
    ],
  });

  // ---------- A planned watch for Amara ----------
  await prisma.plannedTrip.create({
    data: { passengerId: amara.id, originLabel: "Kabeza", destLabel: "Innovation Park", whenLabel: "Tomorrow 08:00 · weekdays", notify: true },
  });

  // ---------- Amara: saved places, wallet ledger, notifications ----------
  await prisma.savedPlace.createMany({
    data: [
      { userId: amara.id, label: "Home", area: "Kabeza, Sector 4", icon: "⌂" },
      { userId: amara.id, label: "Work", area: "Innovation Park", icon: "▣" },
    ],
  });

  await prisma.walletTransaction.createMany({
    data: [
      { userId: amara.id, kind: "CREDIT", amount: 20000, label: "Wallet top-up", createdAt: hoursAgo(30) },
      { userId: amara.id, kind: "DEBIT", amount: 1200, label: "Kabeza → Central Market", createdAt: hoursAgo(20) },
      { userId: amara.id, kind: "DEBIT", amount: 3500, label: "Remera → City Centre", createdAt: hoursAgo(6) },
    ],
  });

  await prisma.notification.createMany({
    data: [
      { userId: amara.id, title: "Booking confirmed", message: "Your seat on Bus 12 → Moto is reserved.", read: false, createdAt: hoursAgo(1) },
      { userId: amara.id, title: "Trip match found", message: "A matching Kabeza → Innovation Park departs at 08:05.", read: false, createdAt: hoursAgo(3) },
      { userId: amara.id, title: "Wallet topped up", message: "You added RWF 20,000 to your Relay wallet.", read: true, createdAt: hoursAgo(30) },
    ],
  });

  console.log(`Seed complete. ${hist} historical bookings, ${passengers.length} passengers, 4 operators.`);
  console.log("Demo logins (password: password123):");
  console.log("  passenger  amara@relay.app");
  console.log("  driver     jean@relay.app");
  console.log("  operator   ops@kigalibus.app");
  console.log("  admin      admin@relay.app");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
