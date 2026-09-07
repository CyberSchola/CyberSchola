"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";


/* Schema for Form validation */
const schema = z.object({
  name: z
  .string()
  .min(3, { message: 'Subject name must be at least 3 characters long!' })
  .max(20, { message: 'Subjcet name must be at most 20 characters long!' }),

  teachers: z.string().min(1, { message: 'Teacher name is required!' }),
});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const SubjectForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {

  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )


  return (
    
    /* FORM */ 
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Subject</h1> : < h1 className="text-xl font-semibold">Update Subject</h1> }

      { /* FORM MODAL LABEL */ }
      <span className="text-xs text-gray-400 font-medium">
        Full Detailed Subject Informations
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* INPUTS */ }
        <InputField label="Subject name" name="name" defaultValue= {data?.name} register={register} error={errors.name} />

        { /* TEACHER NAME INPUT MAIN CONTAINER */ }
        <div className=" flex flex-col gap-2 w-full md:w-2/4 ">

          <label className=" text-xs text-gray-500 ">Teachers Name</label>

          <input type="text" {...register("teachers")} defaultValue={data?.teachers} className=" ring-[1.5px] ring-gray-300 p-2 rounded-md text-sm w-auto " />
        
          {errors.teachers?.message && <p className=" text-xs text-red-400" >{errors.teachers.message.toString() }</p>}
        
        </div>

      </div>
      
        

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default SubjectForm