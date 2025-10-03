keyword_map : dict[str,str] = {
   # --- B.Tech Programs (Merged Variations) ---
    "ETRX": "ETRX",
    "ETRX_MJ 21": "ETRX",
    "ELECTRONICS": "ETRX",
    "ELECTRONICS ENGINEERING": "ETRX",
    
    "ME ENERGY": "ME_ENERGY",  # M.E Energy (separate)
    "ME ENRY": "ME_ENERGY",    # Typo fix
    "ME ENR": "ME_ENERGY",     # Typo fix

    "SEM - V COMP": "COMP",

    "ME ETRX": "ME_ETRX",      # M.E Electronics (separate)
    "SEM - III ETRX": "ETRX",

    "IT": "IT",
    "I.T": "IT",
    "INFORMATION TECHNOLOGY": "IT",
    "ME INS": "ME_IT",         # M.E IT (separate)
    "ME INFORMATION SECURITY": "ME_IT",
    "IT_MJ 21": "IT",
    "SEM - III .I.T": "IT",
    "SEM - III I.T": "IT",
    "IT_SEM VIII": "IT",

    "Sem . III Comp": "COMP",
    "COMP": "COMP",
    "SEM - V . COMP": "COMP",
    "COMPUTER": "COMP",
    "COMPUTER ENGINEERING": "COMP",
    "ME COMP": "ME_COMP",      # M.E Computer (separate)
    "COMP_SEM VIII": "COMP",
    "SEM - VII COMP": "COMP",

    "EXTC": "EXTC",
    "ELECTRONICS AND TELECOMMUNICATION": "EXTC",
    "EXCP": "EXTC",            # Typo fix
    "EXTC_MJ 21": "EXTC",
    "SEM - VII EXTC": "EXTC",
    "ME EXTC": "ME_EXTC",      # M.E EXTC (separate)

    "MECH": "MECH",
    "Sem -III Mech": "MECH",
    "MECH_ SEM VIII": "MECH",
    "MECH_MJ 21": "MECH",
    "MECHANICAL": "MECH",
    "MECHA": "MECH",           # Typo fix
    "ME CAD CAM": "ME_CAD_CAM", # M.E CAD/CAM (separate)
    "ME CAD CAM ROBOTIC": "ME_CAD_CAM",
    "ME CAD CAM ROBOTICS": "ME_CAD_CAM",
    "SEM - V MECH": "MECH",
    "Mechatronics": "MECH",

    # --- First Year ---
    "FE": "FE",
    "FIRST YEAR": "FE",
    "SEM I": "FE",
    "SEM II": "FE",
    "First Year Sem I": "FE",
    "SEM - I & II (ALL)": "FE",

    # --- Autonomous (Treated as Regular) ---
    "AUTONOMOUS": "",          # Ignored (no separate dir)
    "KJSCE AUTONOMOUS": "",    # Ignored (no separate dir)
    "COMP AUTONOMOUS": "COMP", # Merged into regular COMP
    "ETRX AUTONOMOUS": "ETRX",
    "SEM - VII ETRX": "ETRX",
    "EXTC AUTONOMOUS": "EXTC",
    "IT AUTONOMOUS": "IT",
    "MECH AUTONOMOUS": "MECH",

    # --- Inter-Disciplinary ---
    "IDC": "IDC",

    # --- Honors/Minor ---
    "HONOUR": "HONOUR",
    "HONOURS": "HONOUR",
    "MINOR": "MINOR",

    # --- Robotics & AI ---
    "ROBOTICS AND A.I": "ROBOTICS_AI",
    "ROBOTICS": "ROBOTICS_AI",

    # --- M.Tech (Separate) ---
    "M TECH": "MTECH",
    "M.TECH": "MTECH",
    "SEM - III M.TECH": "MTECH",
    "MTECH Sem III ND 2021": "MTECH",
    "5) M.TECH - I": "MTECH",
    "5) M. TECH - I": "MTECH",
    "M. Tech": "MTECH",
    "M.TECH SEM I": "MTECH",
    "MTECH COMP": "MTECH_COMP",
    "M.Tech. Comp. Sem - I": "MTECH_COMP",
    "MTECH ETRX": "MTECH_ETRX",
    "M.Tech. Mech. Sem -I": "MTECH_MECH",
    "M.Tech. Extc. Sem - I": "MTECH_EXTC",
    "MTECH EXTC": "MTECH_EXTC",
    "MTECH IT": "MTECH_IT",
    "M.Tech. I.T. Sem - I": "MTECH_IT",
    "MTECH MECH": "MTECH_MECH",

    # --- PhD (Separate) ---
    "PHD": "PHD",

    # --- Fallbacks (Unchanged) ---
    "ME": "ME",  # Generic M.E (if not categorized)

    # --- Newly extracted (precise additions) ---
    "ETRX_SEM VIII": "ETRX",
    "EXTC_SEM VIII": "EXTC",
    "SEM - III COMP": "COMP",
    "SEM - III ETRX": "ETRX",
    "SEM - III EXTC": "EXTC",
    "SEM - III MECH": "MECH",
    "SEM - V ETRX": "ETRX",
    "SEM - V EXTC": "EXTC",
    "SEM - V I.T": "IT",
    "SEM - VII I.T": "IT",
    "SEM - VII MECH": "MECH",
    "SEM - VII COMP": "COMP",
    "Sem - III .EXTC": "EXTC",
}