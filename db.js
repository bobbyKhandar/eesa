"use server"
import {QuestionModel,userModel,connect} from "@/models"

export async function createQuestion(examName,examType,examFollowup,examMaxMarks,examPassingPercentage,examDegree,examUsers,examquestions ) {
  const examSets=await QuestionModel;
  console.log(examSets)
    const questions = new examSets({
        "examName": examName,
        "examType": examType,
        "examFollowup": examFollowup,
        "examMaxMarks": examMaxMarks,
        "examPassingPercentage": examPassingPercentage,
        "examDegree": examDegree,
        "examUsers": examUsers, 
        "examquestions": examquestions,
 
      })
      questions.save() // Saving the new user document to the database
      .then(exams => console.log('New Exam created:', exams)) 
      .catch(error => console.error(error)); // On error, log the error
  
}
export async function updateResponses(id,response) {
  const examSets=await QuestionModel();
  examSets.updateOne({_id:id},{$push:{studentsResponse:response}})
      questions.save() // Saving the new user document to the database
      .then(exams => console.log('Responses were updated', exams)) 
      .catch(error => console.error(error)); // On error, log the error
}


export async function setUser(userEmail) {
  await connect();
  try {
    const users = await userModel;
    console.log(users);
    console.log((await users.find({userEmail:userEmail})))
    if((await users.find({useremail:userEmail})).length==0){
      
      const user = new users({
        useremail:userEmail,
      })
     user.save().then(()=>{console.log("new user created"+user)})
    }else{
      console.log("if statemment failed dude to "+await users.find({userEmail:userEmail}).length,users.find({userEmail:userEmail}).length==0)
    }
  } catch (error) {
    console.log("error occured when creating data of user in the database"+error)
  }
}
export async function getQuestions(email) {
  await connect(); // Ensure DB connection
  try {
    const results = await QuestionModel.find({ examUsers: email }, { _id: 0, examquestions: 1,examName:1,examDegree:1,examFollowup:1,examMaxMarks:1 });
    console.log(results);
    return JSON.parse(JSON.stringify(results));
  } catch (error) {
    console.error("Error fetching questions:", error);
    return [];
  }
}

export async function getUserRole(email){
  await connect()
  try{
   
    const results = await userModel.find({useremail:email});
    console.log("Data fetched from the database and the user is "+results[0].userRole);
    return results[0].userRole;

  }catch(error){
    console.log(error)
  }
}

export async function getUsers(){
  try {
    const result = await userModel.find({},{_id:0,__v:0}).lean();
    console.log(result)
    return result
  } catch (error) {
    console.log("an error occured when fetching the users data",error)
  }
}

export async function changeRoles(email,role) {
  try {
    userModel.updateOne({useremail:email},{userRole:role}).then((results)=>{console.log(results)})
  } catch (error) {
    console.log("error while making user "+role+" error= "+error)
  }
}

