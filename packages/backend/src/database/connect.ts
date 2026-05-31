    import mongoose from "mongoose";
    import dotenv from "dotenv"
    import path from "path";

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config({ path: path.resolve(__dirname, "../../.env") });
    //at initilization is Connect stays false but after the connection is established the isConnection state changes to true and stays true till the server stops  
    //let isConnected = false; //depritiated was used for laizy connection

    
    const mongodb_url=process.env.mongodb_url
    
    /**
     * Establishes an connection between the database and the api end point 
     * 
     * @remarks
     * This function is strictly ment to be called in the /api route in frontend do not use this in backend     
     * 
     * @returns Object :-
     * sucesscode:
     * possible outputs
     * - successCode 0,1 means sucessfully connected 
     * - successCode 2 means could not connect as database already was connecting
     * - successCode 3 means could not connect as database was disconnecting
     * - successCode -1 means could not connect due to an error
     * 
     *message: messages for debugging does not leak anything private can be sent to the client  
     * 
     */
    export async function connect() {
        if (!mongodb_url) {
            throw new Error("❌ MongoDB URI is missing. Check your .env file.");
    }
    try {
  switch (mongoose.connection.readyState) {
    case 0: // Disconnected
      await mongoose.connect(mongodb_url);
      return{
        successCode: 0,
        message: " DB connected successfully",
      };
      break;

    case 1: // Connected
      return {
        successCode: 1,
        message: " Already connected to the database",
      };

    case 2: // Connecting
      return {
        successCode: 2,
        message: " Database is currently connecting, try again shortly",
      };

    case 3: // Disconnecting
      return {
        successCode: 3,
        message:
          "Database is disconnecting. Please wait until fully disconnected.",
      };

    default:
      return {
        successCode: -1,
        message: "Unknown database connection state",
      };
  }
    } catch (error) {
        console.error("error while acessing mongoose.connection.readystate\n",error)
        return {
            successCode:-1,
            message:"error while acessing mongoose.connection.readystate"
        }
    }
  
    }



/** 
 * Disconnects the connection between database and server
 * @remarks
 * usage should be strictly in api folder in frontend 
 * it is not ment to be used in the backend or anywhere else 
 * checks with the mongoose connection state before disconnecting 
 * 
 * @returns Object:-
 *sucesscode:enum[-1,0,1,2,3]:-
 *  0:Database was already disconnected
 *  1:Disconnected from the database without any error
 *  2:Couldnt disconnect from the database as it was already disconnecting 
 *  3:Couldn't disconnect from the database as it was connecting  
 *  -1:An unpreditable event occured check message for debugging 
 *message:string:-Describles sucess code and any unpreditable event without containing any private information 
  *  can be used for client side error messages
 */
export async function disconnect(): Promise<{ successCode: number; message: string }> {
  try {
    switch (mongoose.connection.readyState) {
      case 0: // Disconnected
        return {
          successCode: 0,
          message: "Database is already disconnected.",
        };

      case 1: // Connected
      try {
        
          await mongoose.disconnect();
          return {
          successCode: 1,
          message: "Disconnected from database successfully.",
        };

      } catch (error) {
        console.error(`errror when disconnecting from the database:- ${error}`)
        return{
            successCode:-1,
            message:"error while trying to use mongoose.disconnect() check logs for more info"
        }
      }
        
      case 2: // Connecting
        return {
          successCode: 2,
          message: "Database is currently connecting. Try disconnecting later.",
        };

      case 3: // Disconnecting
        return {
          successCode: 3,
          message: "Database is already disconnecting. Wait until it finishes.",
        };

      default:
        return {
          successCode: -1,
          message: "Unknown connection state while disconnecting.",
        };
    }
  } catch (error) {
    console.error(" Error during disconnect:", error);
    return {
      successCode: -1,
      message: ` Error while using mongoose.connection.readyState`,
    };
  }
}


// Dropped idea of lazily loading the database connection
    /**establishes connection between mongodb atlas and server using @mongoose 
    * Ensures a global, lazy, singleton DB connection is used throughout the app
    * to avoid redundant connections (especially important in dev/serverless environments).     * 
     */
// //public variables--------------------------------------------------------------------------------------------------------------------
// /**lazily connects to the database on the basis of the private variable isConnected */
//     export async function connectToDb() {
//     // Check if already connected
//     if (isConnected) {
//         console.log("Already connected to the database");
//         return{
//             sucess:true,
//             message:"sucessfully connected to db"
//         };
//     }
//     try{
//     await connect();
//     isConnected=true;
//     return{
//         sucess:true,
//         message:"sucessfully connected to db"
//     }
//     }catch(error){
//     console.error("Error connecting to the database:", error);
//     return{
        
//     }
//     }
//     }


//     connectToDb()