import { CORS_HEADERS, resolveAuth, requireSuperAdmin } from "./utils.ts";
import * as Auth from "./auth.ts";
import * as Teachers from "./teachers.ts";
import * as Students from "./students.ts";
import * as Grades from "./grades.ts";
import * as ClassRecord from "./class-record.ts";
import * as Subjects from "./subjects.ts";
import * as Comms from "./communications.ts";
import * as System from "./system.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const action = String(body?.action || "");

    // -------- Public Actions (No Auth) --------
    switch (action) {
      case "registerTeacher":   return json(await Auth.registerTeacher(body), 200);
      case "teacherLogin":      return json(await Auth.teacherLogin(body), 200);
      case "getPublicTeachers": return json(await Auth.getPublicTeachers(), 200);
      case "getStudent":        return json(await Students.getStudent(body), 200);
      case "registerStudent":   return json(await Students.registerStudent(body), 200);
      case "getTeacherName":    return json(await System.getTeacherName(body), 200);
    }

    // -------- Auth Required --------
    const auth = await resolveAuth(body);
    if (!auth) {
      return json({ success: false, message: "Not authenticated. Please log in again." }, 200);
    }

    // -------- Super Admin Only --------
    const SUPER_ONLY = new Set([
      "listTeachers", "approveTeacher", "rejectTeacher", 
      "setTeacherRole", "setTeacherActive", "resetTeacherPassword", "deleteTeacher"
    ]);
    if (SUPER_ONLY.has(action) && !requireSuperAdmin(auth)) {
      return json({ success: false, message: "Super admin access required." }, 200);
    }

    let result: any;
    switch (action) {
      // Auth / Teachers
      case "getMe":                 result = await Auth.getMe(auth); break;
      case "teacherLogout":         result = await Auth.teacherLogout(body); break;
      case "markWalkthroughSeen":   result = await Auth.markWalkthroughSeen(auth); break;
      case "listTeachers":          result = await Teachers.listTeachers(); break;
      case "approveTeacher":        result = await Teachers.approveTeacher(body, auth); break;
      case "rejectTeacher":         result = await Teachers.rejectTeacher(body); break;
      case "setTeacherRole":        result = await Teachers.setTeacherRole(body); break;
      case "setTeacherActive":      result = await Teachers.setTeacherActive(body); break;
      case "resetTeacherPassword":  result = await Teachers.resetTeacherPassword(body); break;
      case "deleteTeacher":         result = await Teachers.deleteTeacher(body, auth); break;
      case "adminLogin":            result = await Auth.adminLogin(body); break;

      // Students & Pool
      case "getAllGrades":          result = await Students.getAllGradesScoped(body, auth); break;
      case "addStudent":            result = await Students.addStudent(body, auth, false); break;
      case "bulkAddStudents":       result = await Students.addStudent(body, auth, true); break;
      case "updateStudentInfo":     result = await Students.updateStudentInfo(body); break;
      case "deleteStudent":         result = await Students.deleteStudent(body); break;
      case "syncStudentEnrollments": result = await Students.syncStudentEnrollments(body, auth); break;

      // Grades
      case "saveGrades":            result = await Grades.saveGrades(body, auth); break;
      case "saveBreakdown":         result = await Grades.saveBreakdown(body, auth, false); break;
      case "bulkSaveBreakdown":     result = await Grades.saveBreakdown(body, auth, true); break;
      case "recomputeAllGrades":    result = await Grades.recomputeAllGrades(auth); break;

      // Class Record
      case "getClassRecord":        result = await ClassRecord.getClassRecordScoped(body, auth); break;
      case "addAssessment":         result = await ClassRecord.addAssessment(body, auth); break;
      case "renameAssessment":      result = await ClassRecord.renameAssessment(body); break;
      case "deleteAssessment":      result = await ClassRecord.deleteAssessment(body); break;
      case "saveScore":             result = await ClassRecord.saveScore(body); break;
      case "saveScoresBatch":       result = await ClassRecord.saveScoresBatch(body); break;
      case "applyClassRecordToGrades": result = await ClassRecord.applyClassRecordToGrades(body, auth); break;

      // Subjects & Sections
      case "getSubjects":           result = await Subjects.buildSubjectsResponse(auth.teacher?.id || null); break;
      case "manageSubject":         result = await Subjects.manageSubject(body, auth); break;
      case "getSections":           result = await Subjects.buildSectionsPayload(auth.teacher?.id || null); break;
      case "manageSection":         result = await Subjects.manageSection(body, auth); break;

      // Communications
      case "getPendingRegistrations": result = await Comms.getPendingRegistrationsScoped(auth); break;
      case "approveRegistration":   result = await Comms.approveRegistration(body, auth); break;
      case "rejectRegistration":    result = await Comms.rejectRegistration(body, auth); break;
      case "getComments":           result = await Comms.getCommentsScoped(auth); break;
      case "postComment":           result = await Comms.postComment(body, auth); break;
      case "clearComments":         result = await Comms.clearComments(auth); break;
      case "getAnnouncement":       result = await Comms.getAnnouncementScoped(body, auth); break;
      case "getAnnouncementHistory": result = await Comms.getAnnouncementHistoryScoped(auth); break;
      case "saveAnnouncement":      result = await Comms.saveAnnouncement(body, auth); break;
      case "deleteAnnouncement":    result = await Comms.deleteAnnouncement(body, auth); break;

      // System
      case "saveTeacherName":       result = await System.saveTeacherName(body, auth); break;
      case "getMyStats":            result = await System.getMyStats(auth); break;
      case "changeMyPassword":      result = await System.changeMyPassword(body, auth); break;
      case "restoreAll":            result = await System.restoreAll(body, auth); break;

      default:
        return json({ success: false, message: "Unknown action: " + action }, 200);
    }

    return json(result, 200);
  } catch (err) {
    console.error("[admin fn]", err);
    return json({ success: false, message: (err as Error).message || String(err) }, 200);
  }
});