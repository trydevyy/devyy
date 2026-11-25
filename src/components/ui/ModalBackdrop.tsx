// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { useSurfaceMotion } from "../../lib/motion";

export default function ModalBackdrop(props: HTMLMotionProps<"div">) {
  const { instant } = useSurfaceMotion();
  const present = useIsPresent();
  return (
    <motion.div
      {...props}
      data-motion-backdrop
      data-closing={!present || undefined}
      inert={!present || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: instant ? 0 : 0.16, ease: "easeOut" }}
    />
  );
}
