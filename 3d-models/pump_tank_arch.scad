// AquaSentinel -- pump-to-tank arch connector
//
// A rigid printed "straw" that arcs like a semicircle from the small pump's
// outlet hole (DC-PUMP-3V, sitting in its own tank) over to a second,
// separate tank. Made wide and long per request -- all key sizes are
// parameters below so they're easy to change.
//
// Fit check: the generic "DC 3-6V mini submersible pump" this label refers
// to has a barbed outlet that's ~7.5mm OD / ~5mm bore (checked against
// several sellers' spec sheets -- consistent across all of them). A rigid
// printed tube can't stretch over the barb's ridge the way soft vinyl
// tubing does, so the pump-side leg is a straight socket sized about
// 0.3mm UNDER 7.5mm for a snug interference press-fit, not a loose
// slip-fit. Push it on and run a bead of silicone/hot glue around the
// joint for a watertight seal -- that's still the right move even with a
// tight press fit. If your actual pump measures differently, tell me the
// real barb OD (calipers, or just eyeball it against a ruler) and I'll
// resize `socket_id` below.
//
// Print orientation: print flat as designed (arch standing upright) --
// it's a self-supporting semicircle, no supports needed for the curve
// itself. The two open leg ends may want a small brim for bed adhesion
// since they're the only contact points.

$fn = 96;

// ---- Parameters (all mm) ----------------------------------------------
tube_od      = 16;   // outer diameter of the printed tube wall
bore_id      = 9;    // general inner bore along most of the arch/legs --
                      // wider than the pump's own 5mm channel on purpose,
                      // so this tube is never the flow restriction
socket_id    = 7.2;  // pump-side leg only: narrows to this ID for the last
                      // `socket_depth` mm, for a press-fit onto the pump's
                      // ~7.5mm OD outlet barb
socket_depth = 16;   // how far the pump barb inserts into the socket
bend_radius  = 90;   // radius of the arch's centerline -> arch_span = 180mm ("wide")
leg_drop     = 60;   // straight vertical drop at each end, down into the
                      // pump tank / receiving tank ("long")
overlap      = 2;    // extra length so the boolean union/subtract are clean

arch_span   = bend_radius * 2;
apex_height = bend_radius + leg_drop;

// ---- Building blocks -----------------------------------------------------

// A vertical semicircular arch (a flat horizontal half-torus, rotated
// upright) of given tube radius r, centered on the origin, legs at
// x = -bend_radius and x = +bend_radius, apex at (0,0,bend_radius).
module half_torus(r) {
    rotate([90, 0, 0])
        rotate_extrude(angle = 180)
            translate([bend_radius, 0])
                circle(r = r);
}

// One straight leg: a vertical cylinder dropping from z=z0 down to
// z=z0-h, at the given x offset.
module leg(r, x, z0, h) {
    translate([x, 0, z0 - h])
        cylinder(r = r, h = h + overlap);
}

module outer_solid() {
    r = tube_od / 2;
    union() {
        half_torus(r);
        leg(r, -bend_radius, 0, leg_drop);
        leg(r,  bend_radius, 0, leg_drop);
    }
}

// Inner bore: general `bore_id` everywhere, except the bottom
// `socket_depth` of the pump-side leg (x = -bend_radius), which narrows
// to `socket_id` for the press-fit.
module inner_bore() {
    general_r = bore_id / 2;
    socket_r  = socket_id / 2;
    union() {
        half_torus(general_r);
        // tank-side leg: full length at the general bore
        leg(general_r, bend_radius, 0, leg_drop);
        // pump-side leg: general bore for the upper part...
        leg(general_r, -bend_radius, 0, leg_drop - socket_depth);
        // ...narrowing to the press-fit socket for the bottom part
        leg(socket_r, -bend_radius, -(leg_drop - socket_depth) + overlap, socket_depth + overlap);
    }
}

// ---- Final part: outer tube minus inner bore ------------------------------
difference() {
    outer_solid();
    inner_bore();
}

// Assumptions used (see chat), echoed at render time too:
echo(str("arch_span (leg-to-leg width) = ", arch_span, "mm"));
echo(str("total height (leg bottom to apex) = ", apex_height, "mm"));
echo(str("tube OD = ", tube_od, "mm, general bore ID = ", bore_id, "mm"));
echo(str("pump-side socket ID = ", socket_id, "mm for the bottom ", socket_depth, "mm (press-fit onto a ~7.5mm OD barb)"));
