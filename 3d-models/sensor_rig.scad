// AquaSentinel -- bench sensor rig
//
// A board with a wide open-top water tank molded into it, mounts for the
// water-level sensor and the turbidity probe (a capacitive soil-moisture
// sensor repurposed to read turbidity), and a socket for a separate
// "diving board" bracket that cantilevers the gas sensor out over the
// water, sensor-can facing down.
//
// Component sizes used below are real spec-sheet numbers, not guesses --
// checked against manufacturer/seller pages for each part (see chat):
//   - water level sensor board:  ~60 x 20 x 1.2mm  (traces on the bottom half)
//   - capacitive soil/turbidity probe (v1.2): 98 x 23 x ~1.6mm
//   - MQ-series gas sensor module: 38 x 22mm PCB, ~17mm dia round can
// If your actual boards measure differently, tell me the numbers and
// I'll resize the slots -- these are close but not hand-measured.
//
// PRINTING: this file makes TWO parts. Set `part` below to choose which
// one to render/export.
//   part = "board"  -> the board + tank (print as-is, flat, no supports)
//   part = "arm"     -> the diving-board bracket (print lying on its
//                        side -- rotate 90 deg about Y in your slicer so
//                        the post lies flat on the bed; it's a simple L
//                        shape once rotated, no supports needed)

$fn = 64;
part = "board";   // "board" or "arm"

// ---- Board ---------------------------------------------------------------
board_w   = 220;   // X
board_d   = 140;   // Y
board_t   = 4;      // thickness
board_r   = 6;      // corner radius

// ---- Tank (open top, integral to the board) -------------------------------
tank_w      = 150;  // outer X -- "wide" tank
tank_d      = 85;   // outer Y
tank_h      = 55;   // wall height above the board surface
tank_wall   = 3;    // wall thickness
tank_x0     = 30;   // outer footprint origin (min X) on the board
tank_y0     = 27;   // outer footprint origin (min Y) on the board

tank_x1 = tank_x0 + tank_w;
tank_y1 = tank_y0 + tank_d;
tank_top_z = board_t + tank_h;

// ---- Water level sensor slot (interior, back wall) ------------------------
wls_w      = 20;    // sensor board width
wls_t      = 1.2;   // sensor board thickness
wls_slot_gap   = wls_t + 0.6;   // printed-fit clearance
wls_rib_h  = 40;    // how tall the guide rail runs, from the tank floor
wls_rib_protrude = 2.5;
wls_x_center = tank_x0 + 45;    // position along the back wall

// ---- Turbidity probe rim clip (front wall) --------------------------------
probe_w    = 23;
probe_t    = 1.6;
probe_slot_gap = probe_t + 0.7;
probe_clip_h   = 20;    // clip height, rising above the rim
probe_x_center = tank_x0 + tank_w - 45;

// ---- Diving-board post + socket --------------------------------------------
post_w        = 16.6;                  // bracket post cross-section (printed part)
socket_w      = post_w + 0.6;          // socket in the board (press-fit clearance)
socket_depth  = 15;
post_h        = 60;
arm_len       = 70;
arm_w         = 24;
arm_t         = 5;
tip_pad_w     = 34;
tip_pad_d     = 30;
gas_hole_d    = 20;    // clearance hole for the ~17mm MQ sensor can

socket_x = tank_x1 + tank_wall/2;        // centered on the tank's right wall
socket_y = (tank_y0 + tank_y1) / 2;

// =====================================================================
// BOARD + TANK
// =====================================================================
module rounded_plate(w, d, t, r) {
    linear_extrude(height = t)
        offset(r = r)
            offset(delta = -r)
                square([w, d]);
}

module tank_shell() {
    difference() {
        translate([tank_x0, tank_y0, board_t])
            cube([tank_w, tank_d, tank_h]);
        translate([tank_x0 + tank_wall, tank_y0 + tank_wall, board_t])
            cube([tank_w - 2*tank_wall, tank_d - 2*tank_wall, tank_h + 1]);
    }
}

// Vertical card-slot rail pair, standing proud of a wall's interior face,
// running up from the tank floor. `wall_y` is the interior face's Y coord,
// rail protrudes in +Y (i.e. mounted on the back wall, interior facing +Y).
module wls_rails() {
    rib_w = 3;
    gap = wls_w + 1.2;
    for (side = [-1, 1])
        translate([wls_x_center + side*(gap/2) - rib_w/2, tank_y0 + tank_wall, board_t])
            cube([rib_w, wls_rib_protrude, wls_rib_h]);
}

// Rim clip tab for the turbidity probe: a small wall tab with a vertical
// through-slot, standing on top of the front wall.
module probe_clip() {
    // Sits flush ON TOP of the wall (does not embed into it) -- this is
    // one continuous print with the tank, so there's no joint-strength
    // reason to overlap, and overlapping would let the union refill the
    // slot where the tab and wall coincide. Keeping it flush avoids that.
    tab_w = probe_w + 10;
    tab_t = tank_wall + 4;
    difference() {
        translate([probe_x_center - tab_w/2, tank_y1 - tank_wall, tank_top_z])
            cube([tab_w, tab_t, probe_clip_h]);
        translate([probe_x_center - probe_slot_gap/2, tank_y1 - tank_wall - 1, tank_top_z - 1])
            cube([probe_slot_gap, tab_t + 2, probe_clip_h + 2]);
    }
}

module diving_board_socket() {
    // A boss against the tank's outer wall with a square blind hole.
    boss_w = socket_w + 8;
    translate([socket_x, socket_y - boss_w/2, board_t])
        difference() {
            cube([boss_w/2 + 6, boss_w, tank_h * 0.55]);
            translate([-1, boss_w/2 - socket_w/2, -1])
                cube([socket_depth + 1, socket_w, socket_depth + 100]);
        }
}

module board_assembly() {
    union() {
        difference() {
            rounded_plate(board_w, board_d, board_t, board_r);
        }
        tank_shell();
        wls_rails();
        probe_clip();
        diving_board_socket();
    }
}

// =====================================================================
// DIVING BOARD BRACKET (separate printed part)
// =====================================================================
module diving_board_arm() {
    pad_y0 = arm_len - tip_pad_d + post_w/2;      // pad's min-Y, in global coords
    hole_x = post_w/2;
    hole_y = pad_y0 + tip_pad_d/2;

    difference() {
        union() {
            // post -- plugs into the socket above
            cube([post_w, post_w, post_h]);

            // arm -- cantilevers inward over the tank, from the top of the post
            translate([post_w/2 - arm_w/2, 0, post_h - arm_t])
                cube([arm_w, arm_len, arm_t]);

            // tip platform, merged with the arm's far end
            translate([post_w/2 - tip_pad_w/2, pad_y0, post_h - arm_t])
                cube([tip_pad_w, tip_pad_d, arm_t]);

            // four small locating tabs around the gas-sensor PCB footprint
            // (38 x 22mm module, centered over the cutout)
            for (dx = [-1, 1]) for (dy = [-1, 1])
                translate([hole_x + dx*16, hole_y + dy*9, post_h - arm_t])
                    cylinder(d = 3, h = arm_t + 3);
        }
        // gas-sensor clearance hole, cut through the whole assembled solid
        // (post+arm+pad+tabs) so it can't get filled back in by any of them
        translate([hole_x, hole_y, post_h - arm_t - 1])
            cylinder(d = gas_hole_d, h = arm_t + 2 + 1);
    }
}

// =====================================================================
if (part == "board") {
    board_assembly();
} else if (part == "arm") {
    diving_board_arm();
}

echo(str("tank interior (approx): ", tank_w - 2*tank_wall, " x ", tank_d - 2*tank_wall, " x ", tank_h - tank_wall, "mm"));
echo(str("diving-board tip height above board = ", post_h, "mm; arm reaches ", arm_len, "mm in from the tank wall"));
