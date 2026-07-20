import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Types for Prisma results (same as heatmap route)
type VenueData = {
  id: string;
  latitude: number;
  longitude: number;
};

type ActiveBookingGroup = {
  venueId: string;
  _count: { id: number };
};

type RatingData = {
  venueId: string;
  noiseLevel: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const day = Number(searchParams.get("day")); // 0=Mon … 6=Sun // used for simple forecast weighting
  const hour = Number(searchParams.get("hour")); // 0‑23 // used for simple forecast weighting

  // For now, we ignore day/hour and return the same live heatmap data.
  // Future implementation can query historical telemetry for the given slot.
  try {
    const venues = await prisma.venue.findMany({
      select: { id: true, latitude: true, longitude: true },
    });

    const todayStr = new Date().toISOString().split("T")[0];
    const activeBookings = await prisma.booking.groupBy({
      by: ["venueId"],
      where: { date: todayStr, status: "CONFIRMED" },
      _count: { id: true },
    });

    const recentRatings = await prisma.venueRating.findMany({
      select: { venueId: true, noiseLevel: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const heatmapPoints = (venues as VenueData[]).map((venue) => {
      const bookingCount =
        (activeBookings as ActiveBookingGroup[]).find(
          (b) => b.venueId === venue.id,
        )?._count.id || 0;
      const venueNoiseRatings = (recentRatings as RatingData[]).filter(
        (r) => r.venueId === venue.id,
      );
      let noiseScore = 0.2;
      if (venueNoiseRatings.length > 0) {
        const loudCount = venueNoiseRatings.filter(
          (r) => r.noiseLevel === "loud",
        ).length;
        const moderateCount = venueNoiseRatings.filter(
          (r) => r.noiseLevel === "moderate",
        ).length;
        noiseScore += loudCount * 0.4 + moderateCount * 0.2;
      }
      // Simple forecast adjustment: increase weight slightly based on selected hour and day of week
      const hourFactor = hour / 24; // 0‑1
      const dayFactor = day / 7; // 0‑1
      const weight = Math.min(
        0.1 +
          bookingCount * 0.2 +
          noiseScore +
          hourFactor * 0.05 +
          dayFactor * 0.05,
        1.0,
      );
      return [venue.latitude, venue.longitude, weight];
    });

    return NextResponse.json({ success: true, data: heatmapPoints });
  } catch (error) {
    console.error("Forecast heatmap calculation failed:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
