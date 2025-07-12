//to do : add error handling and logging, remove console logs in production , Make all the mongoose models global so that they are not created every time


//IMPORTANT!! NOTE:- when using this file, make sure to call connectToDb() first to ensure the database connection is established else it may throw an error in production
import {
  connect,
  getQuestionModel,
  getsubjectModel,
  getuserModel,
  getQuestionsModel
} from "./models";

import _ from "lodash";


let isConnected = false;
//global database connection so it does not connect every time must be called in api when using any function that uses database
export async function connectToDb() {
  // Check if already connected
  if (isConnected) {
    console.log("Already connected to the database");
    return;
  }
try{
  await connect();
  return;
}catch(error){
  console.error("Error connecting to the database:", error);
}
}




interface QuestionInput {
  questionText: string;
  questionAnswer?: string;
  questionOptions?: string[];
  questionType: "mcq" | "theory";
  questionBloomsTaxonomy: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
}



export async function createExam(
  examName:string,
  examType:string,
  examFollowup:string,
  examMaxMarks:number,
  examPassingPercentage:number,
  examDegree:string,
  examUsers:string[],
  examquestions:QuestionInput[] //array of question objects
) {

  try {
  
  const questionModel = await getQuestionsModel();
  const insertedQuestions=await questionModel.insertMany(examquestions)//inserts the questions in the database and returns an array of inserted documents
  const questionsId= insertedQuestions.map((question) => question._id);//extracts the ids of the inserted questions
  const examSets=await getQuestionModel();
    const questions = new examSets({
        "examName": examName,
        "examType": examType,
        "examFollowup": examFollowup,
        "examMaxMarks": examMaxMarks,
        "examPassingPercentage": examPassingPercentage,
        "examquestions": questionsId,//foreign key to the questions collection
        "examDegree": examDegree,
        "examUsers": examUsers,
      })

      questions.save().then(exams=> console.log('New Exam created:', exams))
    
    }catch (error) {
    console.error("Error creating exam:", error);
  }
}

createExam(
  "Sample Exam",
  "Midterm",   
  "Followup Exam",
  100,
  50,
  "B.Tech"
  ,
  ["bobbykhandar1904@gmail.com"],
  [
    { 
      questionText: "What is the capital of France?",
      questionAnswer: "Paris",
      questionType: "mcq",
      questionBloomsTaxonomy: "remember",
      questionOptions: ["Paris", "London", "Berlin", "Madrid"]
    }
  ]    
)

export async function updateResponses(id, response) {
  const examSets = await QuestionModel();
  examSets.updateOne({ _id: id }, { $push: { studentsResponse: response } });
  questions
    .save() // Saving the new user document to the database
    .then((exams) => console.log("Responses were updated", exams))
    .catch((error) => console.error(error)); // On error, log the error
}

export async function setUser(userEmail) {
  await connect();
  try {
    const users = await getuserModel();
    console.log(users);
    console.log(await users.find({ userEmail: userEmail }));
    if ((await users.find({ useremail: userEmail })).length == 0) {
      const user = new users({
        useremail: userEmail,
      });
      user.save().then(() => {
        console.log("new user created" + user);
      });
    } else {
      console.log(
        "if statemment failed dude to " +
          (await users.find({ userEmail: userEmail }).length),
        users.find({ userEmail: userEmail }).length == 0
      );
    }
  } catch (error) {
    console.log(
      "error occured when creating data of user in the database" + error
    );
  }
}
export async function getQuestions(email) {
  await connect();
  try {
    const QuestionModel = await getQuestionModel();
    const results = await QuestionModel.find(
      { examUsers: email },
      {
        _id: 0,
        examquestions: 1,
        examName: 1,
        examDegree: 1,
        examFollowup: 1,
        examMaxMarks: 1,
      }
    );
    console.log(results);
    return JSON.parse(JSON.stringify(results));
  } catch (error) {
    console.error("Error fetching questions:", error);
    return [];
  }
}

export async function getUserRole(email) {
  await connect();
  try {
    const userModel = await getuserModel();
    const results = await userModel.find({ useremail: email });
    console.log(
      "Data fetched from the database and the user is " + results[0].userRole
    );
    return results[0].userRole;
  } catch (error) {
    console.log(error);
  }
}

export async function getUsers() {
  try {
    const userModel = await getuserModel();
    const result = await userModel.find({}, { _id: 0, __v: 0 }).lean();
    console.log(result);
    return result;
  } catch (error) {
    console.log("an error occured when fetching the users data", error);
  }
}

export async function changeRoles(email, role) {
  try {
    const userModel = await getuserModel();
    userModel
      .updateOne({ useremail: email }, { userRole: role })
      .then((results) => {
        console.log(results);
      });
  } catch (error) {
    console.log("error while making user " + role + " error= " + error);
  }
}

export async function createSubject(
  subjectName,
  subjectDescription,
  subjectDegree,
  subjectMarks,
  subjectUsers,
  subjectPyq,
  subjectSyllabus
  // subjectImage
) {
  try {
    await connect();
    const subjectModel = await getsubjectModel();
    const name = await subjectModel.find({ subjectName: subjectName });
    if (!_.isEmpty(name)) {
      throw new Error("Subject Name already taken");
    }
    const newSubject = new subjectModel({
      subjectName: subjectName,
      subjectDescription: subjectDescription,
      subjectDegree: subjectDegree,
      subjectMarks: subjectMarks,
      subjectUsers: subjectUsers,
      subjectPyq: subjectPyq,
      subjectSyllabus: subjectSyllabus,
      // subjectImage: subjectImage,
    });
    newSubject.save();
    console.log("yay");
    return { success: true };
  } catch (error) {
    console.log(error);
    return { success: false, message: error };
  }
}

export async function updateSubjectRatings(subjectName, rating, feedback) {
  try {
    await connect();
    const subjectModel = await getsubjectModel();
    const subject = await subjectModel.findOne({ subjectName: subjectName });
    const totalRatings = subject.totalRating;
    const numberOfReviews = subject.numberOfReviews;
    subjectModel
      .findOneAndUpdate(
        { subjectName: subjectName },
        {
          $push: {
            subjectReview: {
              studentRating: rating,
              studentFeedback: feedback,
            },
          },
          totalRating: totalRatings + rating,
          numberOfReviews: numberOfReviews + 1,
        },
        { new: true, returnOriginal: false }
      )
      .then((result) => {
        console.log(result);
      })
      .then((error) => {
        if (error) {
          console.log(error);
        }
      });

    console.log("yay");
    return "Rating updated sucessfully";
  } catch (error) {
    console.log(error);
    return error;
  }
}

export async function getSubjects(userEmail) {
  try {
    await connect();
    console.log("get sub working email");
    console.log(userEmail);
    const subjectModel = await getsubjectModel();
    const userSubjects = await subjectModel
      .find({ subjectUsers: userEmail })
      .select({
        subjectName: 1,
        subjectDescription: 1,
        subjectDegree: 1,
        _id: 0,
      });
    console.log(userSubjects);
    return JSON.parse(JSON.stringify(userSubjects));
  } catch (error) {
    return error;
  }
}

// createSubject(
//   "oose",
//   "hehehe",
//   "btech",
//   90,
//   "bobby.k@somaiya.edu",
//   "eesa"
// ).then((result) => {
//   console.log(result);
// });
// updateSubjectRatings("oose", 10, "nah");
