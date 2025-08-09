import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

import * as v1 from "firebase-functions/v1";
import * as Joi from "joi";

import { onRequest } from "firebase-functions/v2/https";
import { debug, error } from "firebase-functions/logger";

import { getFirestore } from "firebase-admin/firestore";

// admin.initializeApp();

/**Remove while deploying to Firebase */
const serviceAccount = require("../../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//Function names are restricted to lower case letters
export const setclaims = onRequest(async (request, response) => {
  //
  const userEmailId = request.body.email;
  const claims = request.body.claims;
  console.log(claims);

  if (!userEmailId || !claims) {
    response.statusCode = 400;
    response.send("Invalid input.");
    return;
  }
  console.log(`Given EmailId: ${userEmailId}`);
  try {
    const user = await getAuth().getUserByEmail(userEmailId);
    //TODO: Check whether this request is coming form superAdmin or Not
    await getAuth().setCustomUserClaims(user.uid, claims);
    response.json({ success: true });
  } catch (error) {
    response.statusCode = 500;
    response.json({
      success: false,
      error,
      message: `Failed to set ${userEmailId} as an admin;.`,
    });
  }
});

export const onusercraete = v1.auth.user().onCreate((user) => {
  console.log(`Custom Trigger: New User Account is created '${user.email}' `);
});

/**
 *
 * Evaluate submitted Quiz
 */
type SubmittedQuestion = {
  questionId: string;
  selectedAnswers: string[];
};

type SubmittedQuiz = {
  quizId: string;
  participant: {
    uid: string;
    displayName: string;
  };
  questions: SubmittedQuestion[];
};

type AnswerDoc = {
  questionId: string;
  correctAnswers: string[];
};

//Define Request Body schema
const reqBodySchema = Joi.object({
  quizId: Joi.string().min(10).required(),
  participant: Joi.object()
    .required()
    .keys({
      uid: Joi.string().required().not(""),
      displayName: Joi.string().required().not(""),
    }),
  questions: Joi.array().required().min(1),
});
export const evaluateanswers = onRequest(
  { invoker: "private" },
  async (req, res) => {
    if (req.method != "POST") {
      res.sendStatus(400);
    }
    const submittedQuiz = req.body as SubmittedQuiz;
    const { error: validationErr } = reqBodySchema.validate(submittedQuiz);
    if (validationErr) {
      console.log(error);
      res.statusCode = 400;
      res.json({ error: validationErr.message });
    } else {
      try {
        //Load the Quiz Answer from Firebase
        const ansDocRef = getFirestore()
          .collection("answers")
          .doc(submittedQuiz.quizId);
        const snapshot = await ansDocRef.get();
        if (snapshot.exists) {
          const questionsInFirebase = snapshot.get("answers") as AnswerDoc[];
          // console.log(`ANSWERS KEY`, questionsInFirebase);

          let score: number = 0;

          submittedQuiz.questions.forEach((submittedQuestion) => {
            const qInFirebase = questionsInFirebase.find((v) => {
              return v.questionId == submittedQuestion.questionId;
            });

            if (!qInFirebase) {
              //Can not find a matching key in Firebase records
              debug(
                `Can not find answer for question in Firebase. QuizId:${submittedQuiz.quizId}, Question ID: ${submittedQuestion.questionId}`
              );
              return;
            }

            // if (
            //   qInFirebase.correctAnswers.length !==
            //   submittedQuestion.selectedAnswers.length
            // ) {
            //   //Incorrect
            //   return;
            // }

            let numOfCorrectSelections = 0;
            submittedQuestion.selectedAnswers.forEach((submittedAnsStr) => {
              const r = qInFirebase.correctAnswers.find((v) => {
                return v == submittedAnsStr;
              });

              if (r == undefined) {
                //Submitted answer string not found in firebase key
              } else {
                //Answer found in key
                numOfCorrectSelections++;
              }
            });

            if (numOfCorrectSelections == qInFirebase.correctAnswers.length) {
              //All answers for this question are correct.
              score++;
            }

            if (
              numOfCorrectSelections > 0 &&
              numOfCorrectSelections < qInFirebase.correctAnswers.length
            ) {
              //Partial answer
              debug(
                `Partially Answered. ${numOfCorrectSelections} out-of ${qInFirebase.correctAnswers.length} are correct. QuizId:${submittedQuiz.quizId}, Question ID: ${submittedQuestion.questionId}`
              );
            }
          });

          res.json({ result: "Success", score });
        } else {
          //We could not find Answers for the Quiz in our Database
          error(
            `No Answers found in Firebase. Quiz Id: ${submittedQuiz.quizId}`
          );
          res.sendStatus(500);
        }
      } catch (err) {
        res.statusCode = 500;
        res.json(err);
      }
    }
  }
);
