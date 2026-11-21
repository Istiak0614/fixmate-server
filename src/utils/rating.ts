/**
 * Rating & Review (optional feature).
 * A service's average rating is recalculated from its reviewed bookings after every new review
 * and stored on the service (ratingAverage, ratingCount), so cards and lists can show it cheaply.
 */
import { getCollections } from "../config/db";
import { toObjectId } from "./objectId";

export async function updateServiceRating(serviceId: string) {
  const _id = toObjectId(serviceId);
  if (!_id) return;

  const { bookings, services } = await getCollections();
  const [stats] = await bookings
    .aggregate<{ average: number; count: number }>([
      { $match: { serviceId, rating: { $exists: true } } },
      { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
    ])
    .toArray();

  await services.updateOne(
    { _id },
    {
      $set: {
        ratingAverage: stats ? Math.round(stats.average * 10) / 10 : 0, // e.g. 4.7
        ratingCount: stats?.count ?? 0,
      },
    }
  );
}