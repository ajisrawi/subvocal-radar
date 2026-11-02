unit mm
# via hole rules (0.2 mm hole edge to other copper, 0.25 mm hole to hole) as copper clearances for a 0.45/0.2 via
rule pcb (clearance 0.1)
rule pcb (clearance 0.13 (type via_via via_wire via_smd via_pin))
set diagonal on
fanout
route 30
clean 2
route 60 12
clean 4
route 30 20
clean 2
critic
miter
