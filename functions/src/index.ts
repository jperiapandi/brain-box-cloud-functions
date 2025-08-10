import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";

import * as v1 from "firebase-functions/v1";
import * as Joi from "joi";

import { onRequest } from "firebase-functions/v2/https";
import { debug, error } from "firebase-functions/logger";

import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  AnswerDoc,
  EvaluatedOption,
  EvaluateQuizResponse,
  QuestionEvaluated,
  QuestionOption,
  SubmittedQuiz,
} from "./types";
import {
  COLXN_ANSWERS,
  COLXN_PARTICIPANT,
  COLXN_PARTICIPATION,
  COLXN_QUIZZES,
} from "./constants";

admin.initializeApp();

// Function names are restricted to lower case letters
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
    // TODO: Check whether this request is coming form superAdmin or Not
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

// Define Request Body schema
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

export const evaluatequiz = onRequest(async (req, res) => {
  if (req.method != "POST") {
    res.sendStatus(400);
  }
  const submittedQuiz = req.body as SubmittedQuiz;
  const { error: validationErr } = reqBodySchema.validate(submittedQuiz);
  if (validationErr) {
    error(error);
    res.statusCode = 400;
    res.json({ error: validationErr.message });
  } else {
    try {
      // Load the questionOptions
      const questionOptionsSnapshot = await getFirestore()
        .collection(COLXN_QUIZZES)
        .doc(submittedQuiz.quizId)
        .get();
      if (!questionOptionsSnapshot.exists) {
        throw new Error(
          `Quiz not found in Firebase. QuizId: ${submittedQuiz.quizId}`
        );
      }
      // Load the correct options form Firebase
      const correctOptionsSnapshot = await getFirestore()
        .collection(COLXN_ANSWERS)
        .doc(submittedQuiz.quizId)
        .get();

      if (!correctOptionsSnapshot.exists) {
        throw new Error(
          `Quiz Answers not found in Firebase. QuizId: ${submittedQuiz.quizId}`
        );
      }

      const questionOptions = questionOptionsSnapshot.get(
        "questions"
      ) as QuestionOption[];
      const correctOptions = correctOptionsSnapshot.get(
        "answers"
      ) as AnswerDoc[];
      const userOptions = submittedQuiz.questions;

      let scoreSum = 0;

      const questionsEvaluated: QuestionEvaluated[] = questionOptions.map(
        (questionOption) => {
          //
          const correctOption = correctOptions.find(
            (o) => o.questionId == questionOption.id
          );
          //
          const userOption = userOptions.find(
            (o) => o.questionId == questionOption.id
          );
          //
          let userAttempted = false;
          let n = 0; // Number of required answers
          let s = 0; // Number of submitted answers
          let score = 0;

          const evaluatedOptions: EvaluatedOption[] =
            questionOption.availableAnswers.map((label) => {
              const isThisPartOfCorrectAnswers =
                correctOption?.correctAnswers.find((v) => v == label) !=
                undefined;

              const isThisPartOfUserSelection =
                userOption?.selectedAnswers.find((v) => v == label) !=
                undefined;

              if (isThisPartOfUserSelection == true) {
                userAttempted = true;
              }

              if (isThisPartOfCorrectAnswers) {
                n++;
              }

              if (isThisPartOfCorrectAnswers && isThisPartOfUserSelection) {
                s++;
              }

              return {
                label,
                userChecked: isThisPartOfUserSelection,
                correct: isThisPartOfCorrectAnswers,
              };
            });

          if (s == 0) {
            // Incorrect.
            score = 0;
          } else if (s === n) {
            // Correct.
            scoreSum++;
            score = 1;
          } else if (s < n) {
            // Partial correct
            scoreSum += s / n;
            score = s / n;
            console.log();
          }

          debug(
            `Question: ${questionOption.questionText} 
            n:${n}  s:${s}  Score:${score}  ScoreSum:${scoreSum}`
          );

          return {
            id: questionOption.id,
            questionText: questionOption.questionText,
            type: questionOption.type,
            userAttempted,
            score,
            evaluatedOptions,
          };
        }
      );

      const evaluatedQuizResp: EvaluateQuizResponse = {
        quizId: submittedQuiz.quizId,
        scoreSum,
        participant: submittedQuiz.participant,
        questionsEvaluated,
      };
      // Write a record in participation
      const participationDocRef = getFirestore()
        .collection(COLXN_PARTICIPATION)
        .doc();

      await participationDocRef.set({
        ...evaluatedQuizResp,
        participatedAt: FieldValue.serverTimestamp(),
      });

      debug(
        `New Participation Document is created ${participationDocRef.path}`
      );

      // Write a Participant doc in the Quiz
      const participantDocRef = getFirestore()
        .collection(COLXN_QUIZZES)
        .doc(submittedQuiz.quizId)
        .collection(COLXN_PARTICIPANT)
        .doc();
      await participantDocRef.set({
        uid: submittedQuiz.participant.uid,
        displayName: submittedQuiz.participant.displayName,
        score: scoreSum,
        participatedAt: FieldValue.serverTimestamp(),
      });

      debug(`New Participant Document is created ${participantDocRef.path}`);
      //
      // Increase the participant count
      await getFirestore()
        .collection(COLXN_QUIZZES)
        .doc(submittedQuiz.quizId)
        .update({ participantsCount: FieldValue.increment(1) });
      //
      // Send Response to client
      res.json(evaluatedQuizResp);
    } catch (err) {
      error(err);
      res.statusCode = 500;
      res.json({ message: (err as Error)?.message });
    }
  }
});
