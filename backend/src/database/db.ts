//to do : add error handling and logging, remove console logs in production , Make all the mongoose models global so that they are not created every time


//IMPORTANT!! NOTE:- when using this file, make sure to call connectToDb() first to ensure the database connection is established else it may throw an error in production
import {
  getQuestionModel,
  getExamModel,
  getSubjectModel,
  getUserModel
} from "./mongooseSchemas.js";
import { Model } from "mongoose";

import {connect,disconnect} from "./connect.js"
import type { Exam,User,Question,Subject} from "./schemas";










interface QuestionInput {
  questionText: string;
  answer?: string;
  questionOptions?: string[];
  type: "mcq" | "theory";
  bloomsTaxonomyLevel: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
}



const questionModel:Model<Question> =  getQuestionModel();
const examModel:Model<Exam>=getExamModel()


export async function createExam(
  examName:string,
  examType:string,
  examFollowup:string,
  examMaxMarks:number,
  examPassingPercentage:number,
  examDegree:string,
  examUsers:string[],
  examQuestions:(Question&{marks:number})[],//question And its MetaData
) {
  
  try {
  await connect().then(message=>{
    console.log(message)
  })
  const questionDocs = examQuestions.map(({ marks, ...rest }) => rest);
  const insertedQuestions=await questionModel.insertMany(questionDocs)//inserts the questions in the database and returns an array of inserted documents
 const examQuestionsWithMarks = insertedQuestions.map((doc, i) => ({
  questionId: doc._id.toString(),
  marks: examQuestions[i].marks
}));
  const newExam = new examModel({
        "examTitle": examName,
        "examType": examType,
        "examFollowup": examFollowup,
        "examMaxMarks": examMaxMarks,
        "examPassingPercentage": examPassingPercentage,
        "examQuestions": examQuestionsWithMarks,//foreign key to the questions collection
        "examDegree": examDegree,
        "examUsers": examUsers,
      })

    const savedExam=await newExam.save()
    console.log(savedExam)
    
    }catch (error) {
    console.error("Error creating exam:", error);
  }finally{
    await disconnect()
  }
}

const x=await createExam(
  "AI Midterm - 2025",
  "theory",
  "Scheduled",
  100,
  40,
  "B.Tech Artificial Intelligence",
  ["664c9d1f1a4a3f1234567890", "664c9d1f1a4a3f1234567891"], // user ObjectId strings
  [
    {
      name: "Explain the concept of Artificial Intelligence with real-world examples.",
      answer: "AI refers to machines that mimic human intelligence...",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "understand",
      marks: 10
    },
    {
      name: "What are the six levels of Bloom's Taxonomy in order?",
      answer: "Remember, Understand, Apply, Analyze, Evaluate, Create",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "remember",
      marks: 5
    },
    {
      name: "Design a chatbot capable of handling student queries for a university portal.",
      answer: "NOT PRESENT",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "create",
      marks: 15
    }
  ]
);

console.log(x)
// export async function updateResponses(id, response) {
//   const examSets = await QuestionModel();
//   examSets.updateOne({ _id: id }, { $push: { studentsResponse: response } });
//   questions
//     .save() // Saving the new user document to the database
//     .then((exams) => console.log("Responses were updated", exams))
//     .catch((error) => console.error(error)); // On error, log the error
// }

// export async function setUser(userEmail) {
//   await connect();
//   try {
//     const users = await getuserModel();
//     console.log(users);
//     console.log(await users.find({ userEmail: userEmail }));
//     if ((await users.find({ useremail: userEmail })).length == 0) {
//       const user = new users({
//         useremail: userEmail,
//       });
//       user.save().then(() => {
//         console.log("new user created" + user);
//       });
//     } else {
//       console.log(
//         "if statemment failed dude to " +
//           (await users.find({ userEmail: userEmail }).length),
//         users.find({ userEmail: userEmail }).length == 0
//       );
//     }
//   } catch (error) {
//     console.log(
//       "error occured when creating data of user in the database" + error
//     );
//   }
// }
// export async function getQuestions(email) {
//   await connect();
//   try {
//     const QuestionModel = await getQuestionModel();
//     const results = await QuestionModel.find(
//       { examUsers: email },
//       {
//         _id: 0,
//         examquestions: 1,
//         examName: 1,
//         examDegree: 1,
//         examFollowup: 1,
//         examMaxMarks: 1,
//       }
//     );
//     console.log(results);
//     return JSON.parse(JSON.stringify(results));
//   } catch (error) {
//     console.error("Error fetching questions:", error);
//     return [];
//   }
// }

// export async function getUserRole(email) {
//   await connect();
//   try {
//     const userModel = await getuserModel();
//     const results = await userModel.find({ useremail: email });
//     console.log(
//       "Data fetched from the database and the user is " + results[0].userRole
//     );
//     return results[0].userRole;
//   } catch (error) {
//     console.log(error);
//   }
// }

// export async function getUsers() {
//   try {
//     const userModel = await getuserModel();
//     const result = await userModel.find({}, { _id: 0, __v: 0 }).lean();
//     console.log(result);
//     return result;
//   } catch (error) {
//     console.log("an error occured when fetching the users data", error);
//   }
// }

// export async function changeRoles(email, role) {
//   try {
//     const userModel = await getuserModel();
//     userModel
//       .updateOne({ useremail: email }, { userRole: role })
//       .then((results) => {
//         console.log(results);
//       });
//   } catch (error) {
//     console.log("error while making user " + role + " error= " + error);
//   }
// }

// export async function createSubject(
//   subjectName,
//   subjectDescription,
//   subjectDegree,
//   subjectMarks,
//   subjectUsers,
//   subjectPyq,
//   subjectSyllabus
//   // subjectImage
// ) {
//   try {
//     await connect();
//     const subjectModel = await getsubjectModel();
//     const name = await subjectModel.find({ subjectName: subjectName });
//     if (!_.isEmpty(name)) {
//       throw new Error("Subject Name already taken");
//     }
//     const newSubject = new subjectModel({
//       subjectName: subjectName,
//       subjectDescription: subjectDescription,
//       subjectDegree: subjectDegree,
//       subjectMarks: subjectMarks,
//       subjectUsers: subjectUsers,
//       subjectPyq: subjectPyq,
//       subjectSyllabus: subjectSyllabus,
//       // subjectImage: subjectImage,
//     });
//     newSubject.save();
//     console.log("yay");
//     return { success: true };
//   } catch (error) {
//     console.log(error);
//     return { success: false, message: error };
//   }
// }

// export async function updateSubjectRatings(subjectName, rating, feedback) {
//   try {
//     await connect();
//     const subjectModel = await getsubjectModel();
//     const subject = await subjectModel.findOne({ subjectName: subjectName });
//     const totalRatings = subject.totalRating;
//     const numberOfReviews = subject.numberOfReviews;
//     subjectModel
//       .findOneAndUpdate(
//         { subjectName: subjectName },
//         {
//           $push: {
//             subjectReview: {
//               studentRating: rating,
//               studentFeedback: feedback,
//             },
//           },
//           totalRating: totalRatings + rating,
//           numberOfReviews: numberOfReviews + 1,
//         },
//         { new: true, returnOriginal: false }
//       )
//       .then((result) => {
//         console.log(result);
//       })
//       .then((error) => {
//         if (error) {
//           console.log(error);
//         }
//       });

//     console.log("yay");
//     return "Rating updated sucessfully";
//   } catch (error) {
//     console.log(error);
//     return error;
//   }
// }

// export async function getSubjects(userEmail) {
//   try {
//     await connect();
//     console.log("get sub working email");
//     console.log(userEmail);
//     const subjectModel = await getsubjectModel();
//     const userSubjects = await subjectModel
//       .find({ subjectUsers: userEmail })
//       .select({
//         subjectName: 1,
//         subjectDescription: 1,
//         subjectDegree: 1,
//         _id: 0,
//       });
//     console.log(userSubjects);
//     return JSON.parse(JSON.stringify(userSubjects));
//   } catch (error) {
//     return error;
//   }
// }

// // createSubject(
// //   "oose",
// //   "hehehe",
// //   "btech",
// //   90,
// //   "bobby.k@somaiya.edu",
// //   "eesa"
// // ).then((result) => {
// //   console.log(result);
// // });
// // updateSubjectRatings("oose", 10, "nah");
