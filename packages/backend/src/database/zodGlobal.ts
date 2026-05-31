/**
* Extended global instance of zod
*
*As per the @zodyac/zod-mongoose zod must be extended with extendZod()  
*Since our schemas are modularized we define z here to ensure consistency
*Always import z from this file importing z from "zod" directly may cause inconsistancy with  @zodyac/zod-mongoose
*/
import { z } from "zod";
import { extendZod } from "@zodyac/zod-mongoose";

extendZod(z); 

export { z };