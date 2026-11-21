import { q, q1 } from './db'
import { istDate, istToDate, addDays } from './format'

export async function todayData(now = new Date()) {
  const today = istDate(now)
  const dayStart = istToDate(today, '00:00')
  const dayEnd = istToDate(addDays(today, 1), '00:00')
  const weekEnd = istToDate(addDays(today, 8), '00:00')
  const monthStart = istToDate(today.slice(0, 8) + '01', '00:00')

  const [followUps, newEnquiries, unread, checkIns, checkOuts, eventsToday, upcomingRooms, upcomingEvents, spaces, money, dueSoon, activity] = await Promise.all([
    q<any>(`SELECT f.*, c.name AS customer_name, c.phone FROM crm.follow_ups f JOIN crm.customers c ON c.id = f.customer_id
            WHERE f.done_at IS NULL AND f.due_on <= $1::date ORDER BY f.due_on, f.created_at LIMIT 30`, [today]),
    q<any>(`SELECT c.id, c.name, c.phone, c.source, c.created_at, c.requirements,
              (SELECT b.id FROM crm.bookings b WHERE b.customer_id = c.id ORDER BY b.created_at DESC LIMIT 1) AS booking_id,
              (SELECT b.status FROM crm.bookings b WHERE b.customer_id = c.id ORDER BY b.created_at DESC LIMIT 1) AS booking_status
            FROM crm.customers c
            WHERE c.created_at >= $1::timestamptz - interval '7 days' AND NOT ('imported_from_old_crm' = ANY(c.import_flags))
              AND NOT EXISTS (SELECT 1 FROM crm.bookings b WHERE b.customer_id = c.id AND b.status IN ('confirmed','completed'))
            ORDER BY c.created_at DESC LIMIT 15`, [dayStart]),
    q<any>(`SELECT c.id, c.name, count(*)::int AS n, max(m.created_at) AS last_at FROM crm.messages m JOIN crm.customers c ON c.id = m.customer_id
            WHERE m.direction = 'in' AND NOT m.read_by_staff GROUP BY c.id, c.name ORDER BY max(m.created_at) DESC LIMIT 10`),
    q<any>(`SELECT i.*, b.ref, b.id AS booking_id, c.name AS customer_name, s.name AS space_name FROM crm.booking_items i
            JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id JOIN crm.spaces s ON s.id = i.space_id
            WHERE i.holds AND s.kind = 'room' AND i.start_at >= $1 AND i.start_at < $2 ORDER BY i.start_at`, [dayStart, dayEnd]),
    q<any>(`SELECT i.*, b.ref, b.id AS booking_id, c.name AS customer_name, s.name AS space_name FROM crm.booking_items i
            JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id JOIN crm.spaces s ON s.id = i.space_id
            WHERE i.holds AND s.kind = 'room' AND i.end_at >= $1 AND i.end_at < $2 ORDER BY i.end_at`, [dayStart, dayEnd]),
    q<any>(`SELECT i.*, b.ref, b.id AS booking_id, b.event_type, b.guests, c.name AS customer_name, s.name AS space_name FROM crm.booking_items i
            JOIN crm.bookings b ON b.id = i.booking_id JOIN crm.customers c ON c.id = b.customer_id JOIN crm.spaces s ON s.id = i.space_id
            WHERE i.holds AND s.kind <> 'room' AND tstzrange(i.start_at, i.end_at, '[)') && tstzrange($1, $2, '[)') ORDER BY i.start_at`, [dayStart, dayEnd]),
    q<any>(`SELECT b.id, b.ref, b.start_at, b.end_at, b.guests, c.name AS customer_name, bb.balance,
              (SELECT string_agg(s.name, ', ') FROM crm.booking_items i JOIN crm.spaces s ON s.id = i.space_id WHERE i.booking_id = b.id AND s.kind = 'room') AS rooms
            FROM crm.bookings b JOIN crm.customers c ON c.id = b.customer_id JOIN crm.booking_balances bb ON bb.booking_id = b.id
            WHERE b.status = 'confirmed' AND b.start_at >= $1 AND b.start_at < $2
              AND EXISTS (SELECT 1 FROM crm.booking_items i JOIN crm.spaces s ON s.id = i.space_id WHERE i.booking_id = b.id AND s.kind = 'room')
            ORDER BY b.start_at LIMIT 20`, [dayEnd, weekEnd]),
    q<any>(`SELECT b.id, b.ref, b.start_at, b.end_at, b.guests, b.event_type, c.name AS customer_name, bb.balance,
              (SELECT string_agg(s.name, ', ') FROM crm.booking_items i JOIN crm.spaces s ON s.id = i.space_id WHERE i.booking_id = b.id AND s.kind <> 'room') AS venues
            FROM crm.bookings b JOIN crm.customers c ON c.id = b.customer_id JOIN crm.booking_balances bb ON bb.booking_id = b.id
            WHERE b.status = 'confirmed' AND b.start_at >= $1 AND b.start_at < $2 AND b.booking_type <> 'room_stay'
            ORDER BY b.start_at LIMIT 20`, [dayEnd, weekEnd]),
    q<any>(`SELECT s.id, s.name, s.kind, p.name AS property_name,
              EXISTS (SELECT 1 FROM crm.booking_items i WHERE i.space_id = s.id AND i.holds AND tstzrange(i.start_at, i.end_at, '[)') && tstzrange($1, $2, '[)')) AS busy
            FROM crm.spaces s JOIN crm.properties p ON p.id = s.property_id WHERE s.active AND p.active ORDER BY p.sort_order, p.name, s.kind, s.sort_order, s.name`, [now, dayEnd]),
    q1<any>(`SELECT
              (SELECT COALESCE(sum(total),0) FROM crm.bookings WHERE status IN ('confirmed','completed') AND created_at >= $1) AS booked_this_month,
              (SELECT COALESCE(sum(total),0) FROM crm.bookings WHERE status = 'confirmed' AND end_at >= now()) AS upcoming_value,
              (SELECT COALESCE(sum(amount),0) FROM crm.payments WHERE voided_at IS NULL AND kind <> 'refund' AND created_at >= $1) AS received_this_month,
              (SELECT COALESCE(sum(amount),0) FROM crm.payments WHERE voided_at IS NULL AND kind = 'advance' AND created_at >= $1) AS advances_this_month,
              (SELECT COALESCE(sum(amount),0) FROM crm.payments WHERE voided_at IS NULL AND kind <> 'refund' AND created_at >= $2) AS received_today,
              (SELECT COALESCE(sum(bb.balance),0) FROM crm.booking_balances bb JOIN crm.bookings b ON b.id = bb.booking_id WHERE b.status IN ('confirmed','completed') AND bb.balance > 0) AS outstanding,
              (SELECT count(*)::int FROM crm.booking_balances bb JOIN crm.bookings b ON b.id = bb.booking_id WHERE b.status IN ('confirmed','completed') AND bb.balance > 0) AS outstanding_count`,
      [monthStart, dayStart]),
    q<any>(`SELECT b.id, b.ref, b.start_at, c.name AS customer_name, bb.balance FROM crm.bookings b
            JOIN crm.customers c ON c.id = b.customer_id JOIN crm.booking_balances bb ON bb.booking_id = b.id
            WHERE b.status = 'confirmed' AND bb.balance > 0 AND b.start_at < $1 ORDER BY b.start_at LIMIT 10`, [weekEnd]),
    q<any>(`SELECT a.*, c.name AS customer_name, b.ref FROM crm.activity a LEFT JOIN crm.customers c ON c.id = a.customer_id
            LEFT JOIN crm.bookings b ON b.id = a.booking_id ORDER BY a.at DESC LIMIT 15`),
  ])
  return { today, followUps, newEnquiries, unread, checkIns, checkOuts, eventsToday, upcomingRooms, upcomingEvents, spaces, money, dueSoon, activity }
}
